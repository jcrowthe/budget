# Targets engine (EXF-511): implementation spec

Design: [targets-engine-design.md](targets-engine-design.md). The rules, the status order, the worked-example
table, the acceptance cases and the manifest are in the design; this file is the task list. Follow
`docs/conventions.md`.

**Do not edit:** anything under `apps/web/`; any `budgets` file; `services/accounts.ts`;
`services/transactions.ts`; `routes/months.ts`; `mcp/tools/months.ts`; `openapi.test.ts`; `mcp.test.ts`;
`e2e/**`; `budget-engine.test.ts`; `months.test.ts`; or any `paths.always_overlap` file. No new dependencies.
After adding the migration, delete `.e2e-state`. Run `pnpm check` after each task.

## T1. Migration `apps/worker/migrations/20261115213604_targets.sql`

Use exactly this file name. It holds one table, with its columns in this order (the guarded insert in T6
depends on the order):

```sql
CREATE TABLE targets (
  category_id TEXT PRIMARY KEY REFERENCES categories(id),
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  cadence TEXT NOT NULL,
  behavior TEXT NOT NULL,
  amount INTEGER NOT NULL,
  day_of_week INTEGER,
  day_of_month INTEGER,
  due_date TEXT,
  due_month TEXT,
  repeat_every INTEGER,
  repeat_unit TEXT,
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX targets_budget ON targets (budget_id);
```

Do not add a CHECK constraint; the design explains why. Verify: `schema-drift.test.ts` passes once T2 is done.

## T2. Drizzle table `apps/worker/src/db/schema/targets.ts`

Export `targets`, with camelCase fields: `categoryId` (primaryKey), `budgetId`, `cadence`
(`text(..., { enum: TARGET_CADENCES })`), `behavior` (enum `TARGET_BEHAVIORS`), `amount`, `dayOfWeek`,
`dayOfMonth`, `dueDate`, `dueMonth`, `repeatEvery`, `repeatUnit` (enum `REPEAT_UNITS`), `createdOn`,
`createdAt`, `updatedAt`. Declare the index `targets_budget` as `accounts.ts` does.

## T3. Core `packages/core/src/targets.ts` (new, pure: no I/O, no `Date.now()`, no `new Date()` without an argument)

Exports:

```ts
export const TARGET_CADENCES = ["weekly", "monthly", "yearly", "custom"] as const;
export const TARGET_BEHAVIORS = ["set_aside", "refill", "fill_up", "balance"] as const;
export const TARGET_STATUSES = ["underfunded", "funded", "on_track", "eventually", "snoozed", "complete"] as const;
export const REPEAT_UNITS = ["month", "year"] as const;
export type TargetCadence / TargetBehavior / TargetStatus / RepeatUnit  // (typeof X)[number]

export interface TargetDefinition {
  cadence: TargetCadence; behavior: TargetBehavior; amount: Milliunits;
  day_of_week: number | null; day_of_month: number | null;
  due_date: string | null; due_month: string | null;
  repeat: { every: number; unit: RepeatUnit } | null;
  created_on: string;
}
export interface TargetMonth {
  definition: TargetDefinition; status: TargetStatus;
  needed_this_month: Milliunits; amount_this_month: Milliunits; funded: Milliunits;
  to_go_this_month: Milliunits; overall_to_go: Milliunits; overfunded: Milliunits;
  percent: number; due_this_month: boolean; period_due_date: string | null;
}
export interface TargetMonthContext {
  month: Month; today: string;              // ISO date; current month = toMonth(today)
  leftover: Milliunits; assigned: Milliunits; activity: Milliunits; available: Milliunits;
  assignedIn: (month: Month) => Milliunits; // this category's Assigned in any month
}
export function ceilCent(n: Milliunits, k: number): Milliunits;
export function countWeekdays(month: Month, dayOfWeek: number, fromDate?: string): number;
export type TargetPeriod = { dueDate: string; dueMonth: Month; startMonth: Month; monthsRemaining: number };
export function targetPeriod(def: TargetDefinition, month: Month): TargetPeriod | "complete" | null;
export function computeTargetMonth(def: TargetDefinition, ctx: TargetMonthContext): TargetMonth | null;
```

These must be type-identical to the Zod outputs in T5. `_sameShape` in `services/months.ts` checks this.

Implementation notes:

- `ceilCent(n, k)`: return 0 when `n <= 0`. Otherwise `Math.ceil(n / (10 * k)) * 10`, done in integers:
  `Math.floor((n + 10 * k - 1) / (10 * k)) * 10`. Check the result with `assertMilliunits`.
- `countWeekdays`: loop over days 1…length of the month and compare
  `new Date(Date.UTC(y, m - 1, d)).getUTCDay()` with `dayOfWeek`. When `fromDate` is given, skip dates before it.
- A local helper `addMonthsToDate(date, n)` returns the same day n months later, clamped to the month's last
  day. A local `lastDay(month)` returns that month's last day. Use `addMonths` and `toMonth` from `./month`.
- `targetPeriod` returns null for `weekly`, `monthly` and `balance` targets. For `yearly` and custom
  `set_aside` / `fill_up` it follows the design's "Periods" section (yearly step 12; custom step `every × (unit
  year ? 12 : 1)`; no repeat → `"complete"` once `month > toMonth(due_date)`).
  `monthsRemaining = monthsBetween(month, dueMonth) + 1`. Write a local `monthsBetween`; do not import the
  engine's private one.
- `computeTargetMonth`:
  1. If `month < toMonth(def.created_on)`, return `null`.
  2. Branch on cadence and behaviour as in the design's rules table. The weekly amount is
     `amount × countWeekdays(month, day_of_week, month === createdMonth ? created_on : undefined)`, and
     `amount_this_month` for weekly is `amount × countWeekdays(month, day_of_week)`. Refill uses
     `month > toMonth(today)` for its future-month rule. Dated set-aside sums
     `assignedIn(m)` for m from `startMonth` up to `month`, `month` excluded.
  3. Balance with `due_month`: the period is `{ dueMonth: due_month, monthsRemaining }`. When
     `month > due_month` the target is `"complete"`. `period_due_date` is `lastDay(due_month)`.
  4. Complete: needed, amount_this_month, to go and overall to go are 0; `due_this_month` is false;
     `period_due_date` is null; `overfunded = max(0, assigned)`; status `complete`.
  5. Status, `overfunded`, `percent` (`Math.floor(100 * funded / goal)` clamped to [0, 100], 100 when the goal
     is 0), `due_this_month` and `period_due_date` follow the design exactly. Never return `-0`: use
     `Math.max(0, x)` and the engine's `neg` pattern where a sign flips.

Verify: T9.

## T4. Engine `packages/core/src/budget-engine.ts` (additive only)

- `import { computeTargetMonth, type TargetDefinition, type TargetMonth } from "./targets"`.
- `export interface EngineTarget extends TargetDefinition { categoryId: string }`.
- `EngineInput` gains `targets?: EngineTarget[]` and `today?: string` (both optional).
- `MonthCategoryDetail` gains `target: TargetMonth | null`.
- In `computeMonth`, build `Map<categoryId, EngineTarget>` from `input.targets ?? []`. If the map is not empty
  and `input.today` is undefined, `throw new RangeError("today is required when targets are given")`. For
  each category, call `computeTargetMonth(def, { month, today, leftover: s.carried, assigned: s.assigned,
  activity: s.activity, available: s.available, assignedIn: (m) => p.assignedByCatMonth.get(`${m}|${c.id}`)
  ?? 0 })`. A category with no target gets `null`. The `definition` in the output omits `categoryId`.
- Leave `computeMonths`, `classifyTransaction`, the timeline and RTA as they are.

Verify: `budget-engine.test.ts` passes unchanged (it compares tuples, so the new field does not affect it).

## T5. Schemas

`packages/schema/src/targets.ts` (new). Import `z` from `@hono/zod-openapi` and name each schema with
`.openapi(...)`. The schema package does not import core: repeat the enum values (T11 asserts they match).

- `TargetCadence`, `TargetBehavior`, `TargetStatus`, `RepeatUnit`: `z.enum([...])`.
- `TargetRepeat = z.object({ every: z.number().int().min(1).max(11), unit: RepeatUnit })`.
- `TargetDefinition = z.object({ cadence, behavior, amount: Milliunits, day_of_week: z.number().int().nullable(),
  day_of_month: z.number().int().nullable(), due_date: IsoDate.nullable(), due_month: Month.nullable(),
  repeat: TargetRepeat.nullable(), created_on: IsoDate })`.
- `CategoryTargetMonth = z.object({ definition: TargetDefinition, status: TargetStatus, needed_this_month,
  amount_this_month, funded, to_go_this_month, overall_to_go, overfunded` (all `Milliunits`)`, percent:
  z.number().int().min(0).max(100), due_this_month: z.boolean(), period_due_date: IsoDate.nullable() })`.
- `Target = TargetDefinition.extend({ budget_id: z.uuid(), category_id: z.uuid(), created_month: Month })`.
- `TargetSet` (input): `budget_id`, `category_id` (uuid), `cadence`, `behavior`, `amount: Milliunits.positive()`,
  `day_of_week?: int 0..6`, `day_of_month?: int 1..31 | null`, `due_date?:` a calendar-valid ISO date with the
  year in 1900–2199 (copy the private `isCalendarDate` from `transactions.ts` and the year regex),
  `due_month?:` a month with the same year bound, `repeat?: TargetRepeat | null`. A `superRefine` enforces these
  combinations, with one issue message per rule. A field marked "absent" may be missing or null:
  - weekly: behaviour `set_aside` or `refill`; `day_of_week` required; `day_of_month`, `due_date`, `due_month`
    and `repeat` absent.
  - monthly: behaviour `set_aside` or `refill`; `day_of_month` optional (missing or null means the last day);
    `day_of_week`, `due_date`, `due_month` and `repeat` absent.
  - yearly: behaviour `set_aside` or `refill`; `due_date` required; `day_*`, `due_month` and `repeat` absent.
  - custom `set_aside` / `fill_up`: `due_date` required; `repeat` optional; `day_*` and `due_month` absent.
  - custom `balance`: `due_month` optional; `due_date`, `repeat` and `day_*` absent.
  - custom `refill` is refused.
- `TargetDelete = z.object({ budget_id: z.uuid(), category_id: z.uuid() })`.
- Export the `z.infer` types.

`packages/schema/src/months.ts`: add `target: CategoryTargetMonth.nullable()` to `MonthCategoryDetail`. Change
nothing else.

Verify: `pnpm -r typecheck`. `_sameShape` in `services/months.ts` must still compile. If it fails, fix the core
types, not the check.

## T6. Repository `apps/worker/src/repositories/targets.ts`

- `export type TargetRow = typeof targets.$inferSelect`.
- `listForBudget(db, budgetId): Promise<TargetRow[]>` and `find(db, budgetId, categoryId)`.
- `toDefinition(row): TargetDefinition` (core type). It maps `repeatEvery` / `repeatUnit` to `repeat`, or to
  null when `repeatEvery` is null.
- `holds(db, budgetId, categoryId, beforeUpdatedAt: string | undefined)`: a `SELECT 1` that holds while the
  row still has that `updated_at`, or, when `undefined`, while there is still no row. Copy
  `month-categories.ts` `holds`.
- `upsertIfHoldsStmt(db, row, beforeUpdatedAt)`: an unexecuted statement. When `beforeUpdatedAt` is undefined,
  it is `insert … select <values in T1 column order> where not exists (row)`. Otherwise it is an `update` of every
  column except `category_id`, `budget_id`, `created_on` and `created_at`, `where category_id = ? and
  budget_id = ? and updated_at = before`.
- `deleteIfHoldsStmt(db, budgetId, categoryId, beforeUpdatedAt)`: an unexecuted guarded delete.

## T7. Service `apps/worker/src/services/targets.ts`

- `export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10)`.
- `export function targetToApi(row): Target` adds `budget_id`, `category_id` and
  `created_month = toMonth(createdOn)` to `toDefinition(row)`.
- `export function buildSetTargetBatch(db, row, log: ChangeLogEntry, beforeUpdatedAt?)` returns
  `[changeLogInsertIf(db, log, holds(...)), upsertIfHoldsStmt(...)] as const`. It is the test seam, like
  `buildSetAssignedBatch`.
- `setTarget(env, actor, input: TargetSet, opts: { today?: string } = {}): Promise<Target>`
  1. `const v = TargetSet.parse(input)`. If `opts.today` is given, parse it with `IsoDate`.
  2. `budgetsRepo.findActive` (else `NotFound("Plan")`) and `categoriesRepo.findActive(db, budget, category)`
     (else `NotFound("Category")`).
  3. Make up to 5 attempts. In each, read `before = find(...)`; set `now = new Date().toISOString()`; build the
     row from `v` (missing optional fields become `null`; `repeat` splits into `repeatEvery` / `repeatUnit`);
     set `createdOn = before?.createdOn ?? opts.today ?? todayUtc()`, `createdAt = before?.createdAt ?? now`
     and `updatedAt = now`. The log entry is `{ budgetId, actor, action: before ? "update" : "create",
     entityType: "target", entityId: category_id, before: before ? targetToApi(before) : null, after:
     targetToApi(row) }`. Run `db.batch(buildSetTargetBatch(...))`. When the write changed a row, return
     `targetToApi(row)`.
  4. After 5 attempts, `throw new Conflict("Target")`.
- `deleteTarget(env, actor, input: TargetDelete): Promise<void>`. Parse the input and check the plan. Then loop:
  `before = find(...)`, and if there is none, `throw new NotFound("Target")`. Batch
  `[changeLogInsertIf(delete entry, before = targetToApi(before), after = null, holds), deleteIfHoldsStmt]`.
  Return when the delete changed a row. After 5 attempts, throw `Conflict`.

## T8. `apps/worker/src/services/months.ts`

- `loadInput(db, budgetId, activityBefore, withTargets = false)`: when `withTargets` is set, also load
  `targetsRepo.listForBudget` and map each row to `{ categoryId: row.categoryId, ...toDefinition(row) }`.
- `getPlanMonth(env, budgetId, month, today: string = todayUtc())`: build the input with `withTargets = true`,
  then `computeMonth({ ...input, today }, month)`. The route and the MCP tool still call it with three
  arguments, so the clock decides today.
- `listPlanMonths` does not change.

## T9. Core tests `packages/core/test/targets.test.ts`

- Write a helper `ctx(month, { L, A, X, history })` that computes `available = L + A + X` and
  `assignedIn = (m) => history[m] ?? 0`. Call `computeTargetMonth` with `today: "2026-11-15"` and a definition
  with `created_on: "2026-11-15"`.
- Cover every cell of the design's worked-example table, then acceptance cases 2 to 6 (rounding, leftover
  rules, weekly counting, the no-date-balance property over a small generated grid of L / A / X, periods and
  `null` before creation).
- Engine wiring (acceptance case 7): use `computeMonth` with groups, categories, assignments, activity, one
  `targets` entry and `today`, and check Dec `to_go_this_month` 70000 and `target: null` for the other
  category. Also check that it throws `RangeError` without `today`.

## T10. Schema tests `packages/schema/test/targets.test.ts`

`TargetSet.safeParse` is `success: true` for one valid body of each kind in the design's examples 1 to 9. It is
`success: false` for each invalid case listed under acceptance case 11, plus: custom `refill`, monthly with
`due_date`, `repeat.every` 12, and a `due_date` of `2027-02-30`.

## T11. Worker tests `apps/worker/test/targets.test.ts`

Seed as in `months.test.ts`: a `ZZ-TEST <uuid>` plan, an on-plan cash account, one group, and one category
per example (each with its own target) plus one without a target.

- **Examples 1, 3, 5 and 6** (acceptance case 8). For each, call `setTarget(..., { today: "2026-11-15" })`.
  Replay the steps with `setAssigned` (absolute values, so each step overwrites the last) and
  `createTransaction` (spending: dated 2026-11-10, negative amounts). Read
  `getPlanMonth(env, bid, M, "2026-11-15")` and assert the design's numbers. Example 3 needs Oct A 50000 for
  the leftover and Nov X −80000, which leaves Available 70000. Example 6 uses one more category with its own
  target and no assignments for "no history: Jan 150000".
- **REST = MCP** (acceptance case 9). REST `data` (parsed with `MonthDetailResponse`) for 2026-12-01 deep-equals
  the MCP tool's `run` output and `getPlanMonth(env, bid, DEC, todayUtc())`. Call the tool as `months.test.ts`
  does.
- **History** (acceptance case 10). Create, replace (another amount) and delete on one category give `change_log`
  rows with `entity_type = 'target'`, actions `create`, `update`, `delete`, the actor passed, `budget_id`, and
  `before_json` / `after_json` as specified. The replace keeps `created_on`. After the delete, the month shows
  `target: null`. Atomicity: `buildSetTargetBatch` with `action: "bogus" as never` rejects in `db.batch`, and
  `SELECT count(*) FROM targets WHERE category_id = ?` is 0.
- **Errors** (acceptance case 11). The `ZodError` cases, `NotFound` for a category of another plan,
  `deleteTarget` with no target → `NotFound`. The enum equality check: `[...TargetCadence.options]` equals
  `[...TARGET_CADENCES]`, and likewise for behaviours, statuses and repeat units.

## T12. Docs

`docs/README.md` already has the design line (the Architect added it). Do not edit the README's other text.
Delete `.e2e-state`, then run `pnpm check`. Run `pnpm e2e e2e/months.spec.ts e2e/mcp.spec.ts` to show that the
unchanged specs pass. Leave the full suite to final_gate.
