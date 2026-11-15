# Budget engine (EXF-485): implementation spec

Design: [budget-engine-design.md](budget-engine-design.md). Rules, tables, acceptance cases and the manifest are
there. This file is the task list. Follow `docs/conventions.md`. Copy the shape of the `budgets` slice but **do
not edit** any `budgets` file, anything under `apps/web/`, or any `paths.always_overlap` file (no new
dependencies are needed). After adding the migration, delete `.e2e-state`. Run `pnpm check` after each task.

## T1. Migration `apps/worker/migrations/20261115203000_budget_engine.sql`

Use exactly this file name. Create the six tables and the indexes listed in the design's Data table, in
dependency order (groups, categories, month_categories, months, accounts, transactions).

- Booleans: `INTEGER NOT NULL DEFAULT 0` (`on_budget` has no default).
- Money: `INTEGER NOT NULL`. Months and dates: `TEXT NOT NULL`.
- Foreign keys: `REFERENCES <table>(id)`, with no `ON DELETE` (rows are soft-deleted).
- `transactions.cleared TEXT NOT NULL DEFAULT 'uncleared' CHECK (cleared IN ('uncleared','cleared','reconciled'))`.
- No CHECK on `accounts.type`.
- `month_categories` PRIMARY KEY (`budget_id`, `month`, `category_id`); `months` PRIMARY KEY (`budget_id`, `month`).

Verify: `schema-drift.test.ts` passes after T2.

## T2. Drizzle tables `apps/worker/src/db/schema/`

One file per table: `category-groups.ts` (`categoryGroups`), `categories.ts` (`categories`),
`month-categories.ts` (`monthCategories`, composite `primaryKey`), `months.ts` (`months`), `accounts.ts`
(`accounts`, `type: text("type", { enum: ACCOUNT_TYPES })`), `transactions.ts` (`transactions`,
`cleared: text("cleared", { enum: CLEARED_STATUSES })`). Field names are camelCase (`budgetId`, `sortOrder`,
`onBudget`, `inflowToReadyToAssign`, `deletedAt`, …). Columns must match T1 exactly. Booleans use
`integer(..., { mode: "boolean" })`. Declare the indexes as in `change-log.ts`.

## T3. Core `packages/core/src/account-types.ts`

```ts
export const ACCOUNT_TYPES = ["checking","savings","cash","creditCard","lineOfCredit","mortgage","autoLoan",
  "studentLoan","personalLoan","medicalDebt","otherDebt","otherAsset","otherLiability"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const CREDIT_ACCOUNT_TYPES: readonly AccountType[] = ["creditCard", "lineOfCredit"];
export const CLEARED_STATUSES = ["uncleared", "cleared", "reconciled"] as const;
export type ClearedStatus = (typeof CLEARED_STATUSES)[number];
```

## T4. Core engine `packages/core/src/budget-engine.ts`

Pure. Imports only `./money`, `./month` and `./account-types`. Uses integer arithmetic only (`addMilliunits`,
or `+` with `assertMilliunits` on results).

```ts
export interface EngineGroup { id: string; name: string; sortOrder: number; hidden: boolean; collapsed: boolean }
export interface EngineCategory { id: string; groupId: string; name: string; sortOrder: number; hidden: boolean }
export interface EngineAssignment { categoryId: string; month: Month; assigned: Milliunits }
export interface EngineActivity {
  date: string;                 // ISO date (any day; a pre-summed row uses the month's first day)
  amount: Milliunits;           // signed: outflow < 0
  categoryId: string | null;
  inflowToReadyToAssign: boolean;
  onBudget: boolean;
  accountType: AccountType;
}
export interface EngineNote { month: Month; note: string | null }
export interface EngineInput {
  groups: EngineGroup[]; categories: EngineCategory[]; assignments: EngineAssignment[];
  activity: EngineActivity[]; notes: EngineNote[];
}

export type Classified =
  | { kind: "ignored" } | { kind: "rta_inflow" }
  | { kind: "category"; categoryId: string } | { kind: "uncategorized" };
/** The single place for counting rules. Credit rules will extend this later. */
export function classifyTransaction(a: EngineActivity, activeCategoryIds: ReadonlySet<string>): Classified;

// Output: the wire shape (snake_case), identical to the API schema in T5.
export interface RtaBreakdown { left_over_from_previous: Milliunits; inflows: Milliunits;
  cash_overspending_previous: Milliunits; assigned_in_month: Milliunits; assigned_in_future: Milliunits }
export interface MonthCategoryDetail { id: string; name: string; sort: number; hidden: boolean;
  assigned: Milliunits; activity: Milliunits; available: Milliunits; carried: Milliunits }
export interface MonthGroupDetail { id: string; name: string; sort: number; hidden: boolean; collapsed: boolean;
  assigned: Milliunits; activity: Milliunits; available: Milliunits; categories: MonthCategoryDetail[] }
export interface MonthDetail { month: Month; note: string | null; ready_to_assign: Milliunits;
  rta_breakdown: RtaBreakdown; groups: MonthGroupDetail[];
  uncategorized: { activity: Milliunits; available: Milliunits } | null }
export interface MonthSummary { month: Month; note: string | null; ready_to_assign: Milliunits;
  assigned: Milliunits; activity: Milliunits; available: Milliunits }

export function computeMonth(input: EngineInput, month: Month): MonthDetail;
export function computeMonths(input: EngineInput, from: Month, to: Month): MonthSummary[];
```

Rules (the design's "Rules as built" and implicit rules 1 to 6):

- `classifyTransaction` returns `ignored` when `!onBudget` and `rta_inflow` when the flag is set. It returns
  `category` when `categoryId` is in `activeCategoryIds`, and `uncategorized` otherwise.
- `activeCategoryIds` = the categories whose `groupId` is in `groups`. Drop categories with an unknown group,
  and assignments of unknown categories.
- The timeline runs from `min(requested month, earliest month among assignments and non-ignored activity)` up
  to the requested month (`computeMonths`: up to `to`). For each month it computes per-category
  carry/assigned/activity/available, the uncategorized bucket (Assigned 0), `CashOverspending`, and cumulative
  RTA inflows. Then:
  - `ready_to_assign = inflowsThrough(M) - overspendingBefore(M) - assignedAll`;
  - the breakdown is as in the design (signed contributions);
  - assert in code that the five fields sum to `ready_to_assign` (throw if not).
- Groups are sorted by `sortOrder` then `id`, and categories within a group the same way. Group sums count
  categories with `hidden === false`.
- `uncategorized` is `null` iff there is no uncategorized activity row dated in M and its available is 0.
- A `MonthSummary` takes `assigned`/`activity`/`available` = sums over **all** active categories (hidden
  included), without uncategorized.
- `note` = the input note for M, or `null`.
- `computeMonths` throws `RangeError` if `to < from`.

Verify: T10.

## T5. Zod schemas `packages/schema/src/`

Import `z` from `@hono/zod-openapi` and name every exported schema with `.openapi("<Name>")`. Use `Milliunits`
from `common/money` and `Month`/`IsoDate` from `common/dates`. The literal lists are repeated here (schema does not
depend on core); T11 asserts they equal core's.

- `categories.ts`: `CategoryGroup` { id, budget_id, name, sort, hidden, collapsed }; `Category` { id, budget_id,
  group_id, name, sort, hidden }; `CategoryGroupCreate` { budget_id: uuid, name: trim 1..100, hidden?: boolean };
  `CategoryCreate` { budget_id, group_id: uuid, name: trim 1..100, hidden?: boolean }.
- `months.ts`: `RtaBreakdown`, `MonthCategoryDetail`, `MonthGroupDetail`, `MonthDetail` (exactly the core T4 shapes),
  `MonthDetailResponse = dataEnvelope(MonthDetail)`, `MonthSummary`,
  `MonthListResponse = dataEnvelope(z.object({ months: z.array(MonthSummary) }))`,
  `MonthCategory` { month, category_id, assigned };
  `AssignedSet` { budget_id, month: Month, category_id, assigned: Milliunits };
  `MoneyMove` { budget_id, month, from_category_id: uuid|null, to_category_id: uuid|null, amount: Milliunits > 0 },
  refined so that not both are null and `from !== to`;
  `MonthNoteSet` { budget_id, month, note: string max 500 | null }.
- `accounts.ts`: `AccountType = z.enum([...13])`; `Account` { id, budget_id, name, type, on_budget, note, starred,
  closed, sort, created_at }; `AccountCreate` { budget_id, name: trim 1..100, type, on_budget: boolean,
  note?: string|null }.
- `transactions.ts`: `ClearedStatus = z.enum(["uncleared","cleared","reconciled"])`; `Transaction` { id, budget_id,
  account_id, date, payee_name, category_id, inflow_to_ready_to_assign, memo, amount, cleared, approved,
  created_at }; `TransactionCreate` { budget_id, account_id, date: IsoDate, amount: Milliunits,
  category_id?: uuid|null, inflow_to_ready_to_assign?: boolean (default false), payee_name?: string max 200|null,
  memo?: string max 500|null, cleared?: ClearedStatus (default "uncleared"), approved?: boolean (default true) },
  refined to refuse `category_id` together with the inflow flag.

Export `type X = z.infer<typeof X>` for each schema. In `apps/worker/src/services/months.ts`, add a
type-level check that core's `MonthDetail` is assignable to the schema's `MonthDetail` type, and the reverse.

Verify: `packages/schema/test/months.test.ts` covers the refinements of `MoneyMove` and `TransactionCreate`
and rejects a fractional amount.

## T6. Repositories `apps/worker/src/repositories/`

One file per table, in the style of `repositories/budgets.ts` (reads, plus `*Stmt` functions that return
**unexecuted** statements):

- `category-groups.ts`: `listActive(db, budgetId)`, `findActive(db, budgetId, id)`, `maxSort(db, budgetId)`,
  `insertStmt(db, row)`.
- `categories.ts`: `listActive(db, budgetId)` (inner join on an active group), `findActive(db, budgetId, id)`
  (active itself and active group), `maxSort(db, groupId)`, `insertStmt(db, row)`.
- `month-categories.ts`: `listForBudget(db, budgetId)`, `find(db, budgetId, month, categoryId)`,
  `setStmt(db, {budgetId, month, categoryId, assigned, updatedAt})` (upsert setting the value) and
  `addStmt(db, {…, delta})` (upsert `assigned = assigned + excluded.assigned`, via `onConflictDoUpdate` with
  ``sql`${monthCategories.assigned} + excluded.assigned` ``).
- `months.ts`: `listNotes(db, budgetId)`, `find(db, budgetId, month)`, `upsertNoteStmt(db, {…})`.
- `accounts.ts`: `findActive(db, budgetId, id)`, `maxSort(db, budgetId)`, `insertStmt(db, row)`.
- `transactions.ts`: `insertStmt(db, row)`, and `activityByMonth(db, budgetId, before: string)`. The second
  sums `amount` over transactions with `deleted_at IS NULL` joined to accounts with `deleted_at IS NULL`, in the
  plan, with `date < before`, grouped by `substr(date,1,7)`, `category_id`, `inflow_to_ready_to_assign`,
  `accounts.on_budget` and `accounts.type`. It returns `EngineActivity[]`, with `date` = `<yyyy-mm>-01`.

## T7. Services

The shared pattern for every mutation `(env, actor, input)`:

1. `const v = Schema.parse(input)`.
2. `budgetsRepo.findActive` (import from `repositories/budgets`, read-only use), or `throw new NotFound("Plan")`.
3. Load referenced rows scoped by `budget_id`, or `NotFound("Category group" | "Category" | "Account")`.
4. Build the row(s) and the `changeLogInsert` entries (`budgetId`, `actor`, `entityType`, `entityId`,
   `before`, `after`).
5. Run one `await db.batch([...])` and return the API object.

Expose a test seam for atomicity like `buildCreateBatch`: `buildSetAssignedBatch(db, row, log)` in
`months.ts`.

- `services/categories.ts`: `createCategoryGroup(env, actor, input: CategoryGroupCreate): Promise<CategoryGroup>`;
  `createCategory(env, actor, input: CategoryCreate): Promise<Category>`. Also `toApi` mappers. `sort_order` =
  `maxSort + 1` (0 when there is none).
- `services/months.ts`:
  - `setAssigned(env, actor, input: AssignedSet): Promise<MonthCategory>`. `before` = the existing value or 0.
    One `update` entry for `month_category` with id `${category_id}:${month}`.
  - `moveMoney(env, actor, input: MoneyMove): Promise<MonthCategory[]>` (the changed rows, from then to). It
    uses `addStmt` with `-amount` / `+amount`. Write one `change_log` entry per changed row, whose `after` has a
    `move: { from_category_id, to_category_id, amount }` and `assigned = before + delta`.
  - `setMonthNote(env, actor, input: MonthNoteSet): Promise<{ month; note }>`. One `update` entry for `month`
    with id = month.
  - `getPlanMonth(env, budgetId, month): Promise<MonthDetail>`. It loads groups, categories, assignments, notes,
    and `activityByMonth(…, addMonths(month, 1))`, then calls `computeMonth`.
  - `listPlanMonths(env, budgetId, from, to): Promise<MonthSummary[]>`, the same with `computeMonths`, and
    activity before `addMonths(to, 1)`.
  - Both reads throw `NotFound("Plan")` for an unknown or deleted plan.
- `services/accounts.ts`: `createAccount(env, actor, input: AccountCreate): Promise<Account>`. `starred` and
  `closed` are false; `sort_order` = max + 1.
- `services/transactions.ts`: `createTransaction(env, actor, input: TransactionCreate): Promise<Transaction>`.
  The account must be active in the plan. The category, if given, must be active in the plan.

## T8. Route `apps/worker/src/routes/months.ts`

Default-export an `OpenAPIHono<AppEnv>` with tag `Months` and a `defaultHook` that returns
`apiError(c, 422, "unprocessable_entity", <issues>)` on any validation failure.

- `GET /budgets/{budget_id}/months/{month}`: params `{ budget_id: z.string().min(1), month: Month }`.
  Responses: 200 `MonthDetailResponse`, plus 404 and 422 `ErrorBody`. Body `{ data: await getPlanMonth(...) }`.
- `GET /budgets/{budget_id}/months`: query `{ from: Month, to: Month }`, refined so that `to ≥ from` and the
  span is ≤ 120 months. 200 `MonthListResponse`; body `{ data: { months } }`.

## T9. MCP tool `apps/worker/src/mcp/tools/months.ts`

`export const tools: McpToolDef[] = [{ name: "get_plan_month", description: "Read one month of a plan: Ready to
Assign with its breakdown, and Assigned/Activity/Available per category group and category, in milliunits.",
inputSchema: z.object({ budget_id: z.string().min(1), month: Month }), run: (i, { env }) => getPlanMonth(env,
i.budget_id, i.month) }]`.

## T10. Core tests `packages/core/test/budget-engine.test.ts`

Design acceptance cases 1, 2 and 3. Build the input with small helpers (`tx(date, amount, cat)`,
`assign(cat, month, x)`). For the properties, use a seeded deterministic generator (no new dependency): 50 inputs,
3 categories, random assigns and activity over 4 months.

## T11. Worker tests

- `apps/worker/test/months.test.ts`: design cases 4 to 10. Call services directly with `env` from
  `cloudflare:test` and actor `"user:tester@localhost"`, and read through `json(...)` from `./helpers`. Name data
  `ZZ-TEST <random>`. Never assume an empty database: always use a fresh plan.
- `apps/worker/test/openapi.test.ts`: add the two paths to the expected list.
- `apps/worker/test/mcp.test.ts`: expected tool names become `["create_budget", "get_plan_month", "list_budgets"]`.
- Add an assertion that `AccountType.options` equals core `ACCOUNT_TYPES` and that `ClearedStatus.options`
  equals `CLEARED_STATUSES` (in `months.test.ts`).

## T12. E2E

- `e2e/mcp.spec.ts`: expected tool list adds `get_plan_month`, sorted.
- `e2e/months.spec.ts`: design case 12. Use `authHeaders()` and `testName()` from the existing fixtures, as
  in `e2e/api.spec.ts`. Run only `pnpm e2e e2e/months.spec.ts e2e/mcp.spec.ts e2e/api.spec.ts`; do not run
  the full suite.

## T13. Docs

`docs/README.md` already has this Build's line. Commit with a message starting `EXF-485: `.

## Done when

`pnpm check` passes; the three e2e specs above pass; `git diff --name-only origin/main` lists only files in the
design's Manifest; and `git diff origin/main -- apps/web 'apps/worker/src/**/budgets.ts' packages/schema/src/budgets.ts` is empty.
