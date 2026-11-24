# Targets engine (EXF-511): design

For every category with a target and every month, the server computes what the target needs this month, how
much is funded, what is left to go, the status and the percent. The month read model returns these figures
with the target's definition. This Build also creates the `targets` table and the `setTarget` / `deleteTarget`
services. It adds no UI, no new REST path and no new MCP tool. It builds on main `0eb64f8` (budget engine,
EXF-485). Spec: [targets-engine-spec.md](targets-engine-spec.md).

## Source

The source app is **not** studied in this Build. The ticket and the Lead forbid opening it because other work
is going on in the only plan we may use. Discovery observed the rules and worked examples in EXF-511 in the
source, and they are the specification. The form fields (EXF-508), snooze (EXF-516) and credit card targets
(EXF-538) come from their tickets as read on 2026-11-15. No notes or screenshots were taken here. Where this
design goes beyond what was observed, it says **(not observed)**.

## Definitions

For category C and month M (money in integer milliunits, a month is its first day):

- `L` = leftover = the engine's `carried` (`max(Available(C,M−1), 0)`). `A` = Assigned in M. `X` = Activity in
  M. `V` = Available = `L + A + X`.
- `cur` = the current month = `toMonth(today)`. `today` is an **input**. The Worker passes the UTC date, the
  same rule `currentMonth()` already uses.
- `createdMonth` = `toMonth(created_on)`. For **months before `createdMonth` the category has `target: null`**
  (EXF-508: "a target applies from the month it was created").
- `ceilCent(n, k)` = n / k rounded **up** to a whole cent (10 milliunits), with 0 when n ≤ 0. In integers this
  is `ceil(n / (10k)) × 10`. For example 620000/6 gives 103340 and 516660/4 gives 129170.
- `k` = monthsRemaining = months from M to the period's due month, inclusive.
- `percent` = `floor(100 × funded / goal)`, clamped to 0…100. When the goal is 0 the percent is 100.

### Periods (yearly and custom dated kinds)

`firstDue` = `due_date`. Yearly targets repeat every 12 months. Custom `set_aside` / `fill_up` repeat when
`repeat` is set, with step = `every` × (1 for `month`, 12 for `year`).

- **Not repeating:** if M > `toMonth(firstDue)`, the target is **complete**. Otherwise the period's due date is
  `firstDue` and the period starts at `createdMonth`.
- **Repeating:** n is the smallest n ≥ 0 with `toMonth(firstDue) + n·step ≥ M`. The period's due date is
  `firstDue` plus n·step months, with the day clamped to the month's length. The period starts at
  `createdMonth` when n = 0, and otherwise at `max(createdMonth, previous due month + 1)`.
- `assignedBefore` = the sum of the category's Assigned over the months in [period start, M).

## Rules by kind (as built)

| Kind (`cadence` / `behavior`) | `needed_this_month` | `funded` | `to_go_this_month` | `overall_to_go` | goal (percent) |
|---|---|---|---|---|---|
| monthly / set_aside | `amount` | A | max(0, needed − A) | = to go | needed |
| weekly / set_aside | `amount` × counted weekdays | A | max(0, needed − A) | = to go | needed |
| monthly or weekly / refill | the monthly amount (as above) | M ≤ cur: L + A; M > cur: **A** | max(0, needed − funded) | = to go | needed |
| yearly / set_aside, custom / set_aside | ceilCent(T − assignedBefore, k) | assignedBefore + A ("Assigned So Far") | max(0, needed − A) | max(0, T − funded) | T |
| custom / fill_up, yearly / refill | ceilCent(T − L, k) | L + A | max(0, needed − A) | max(0, T − funded) | T |
| custom / balance with `due_month` | ceilCent(T − L − X, k) | V | max(0, needed − A) | max(0, T − V) | T |
| custom / balance, no date | 0 | V | 0 | max(0, T − V) | T |

T is the target's `amount`. Notes on the table:

- **Weekly counting:** the weekly amount is counted for each date in M that falls on `day_of_week`
  (0 = Sunday … 6 = Saturday, UTC calendar). In `createdMonth`, dates before `created_on` do not count.
- **Refill copies the source as observed.** In a month after the current month, funded counts only that
  month's Assigned and ignores the leftover. In example 3, December shows "to go 70" while Available is 100.
  This looks odd, and we copy it on purpose. Past months (M < cur) use L + A, like the current month
  **(not observed)**.
- **Set-aside kinds ignore the leftover.** Fill-up and balance kinds count it in every month. Balance also
  counts this month's spending, so spending raises the need.
- **`amount_this_month`** is the full-month figure. The inspector lists it as "Amount to Assign This Month" and
  Cost to Be Me adds it up. For weekly targets it counts **every** matching date in M, with no excusing
  (example 4: needed 50, amount_this_month 100; a weekly $10 target adds 40 in Nov). For refill it is the
  monthly amount. For every other kind it equals `needed_this_month` (0 for no-date balance and for complete).
- **`overfunded`** = max(0, A − needed). For refill it is max(0, funded − needed): leftover 50 + assigned 100
  gives 50. For no-date balance it is max(0, min(A, V − T)), so savings toward an "eventually" goal are never
  called surplus **(not observed)**.
- **`yearly / refill`** works like a fill-up that repeats every year **(not observed;** the form offers it and
  the ticket gives no rule).
- `created_on` is kept when a target is replaced (edited). It is set only when the category had no target
  **(not observed;** this matches "applies from the month it was created").

### Status

Statuses, in order of precedence:

1. `complete`: a non-repeating dated kind with M after its due month. `needed_this_month`,
   `amount_this_month`, to go and overall to go are 0 (so overfunded = max(0, A)), and `due_this_month` is
   false. Percent and funded follow the table. Example 8
   January shows "Funded" in the source. The value `complete` lets the display tell "done" apart from "funded
   this month". After the date passes, every non-repeating dated kind is treated this way. The ticket observed
   it for fill-up only.
2. Monthly and weekly kinds (set_aside, refill): `funded` when to go = 0, otherwise `underfunded`. There is no
   overdue state when the due day has already passed.
3. Dated kinds (yearly, custom set_aside, fill_up, balance with a date): `funded` when overall to go = 0;
   otherwise `on_track` when to go this month = 0; otherwise `underfunded`.
4. No-date balance: `funded` when V ≥ T, otherwise `eventually`. It is never `underfunded`.
5. `snoozed` is in the type for EXF-516. Nothing produces it yet.

`due_this_month`: true for weekly and monthly. For dated kinds it is true when the period's due month is M. It
is false for no-date balance and for complete targets.

`period_due_date`: for monthly targets, `day_of_month` clamped to M's length, or M's last day when
`day_of_month` is null. For yearly and custom set_aside / fill_up, the period's due date. For balance with a
date, the last day of `due_month`. Null for weekly, no-date balance and complete.

### Worked examples (every one reproduces; created 2026-11-15, cur = Nov 2026 unless stated)

| # | Case | Expected (milliunits) |
|---|---|---|
| 1 | monthly set_aside 100000, last day | Nov A 40000: needed 100000, to go 60000, 40%, underfunded. A 100000: funded. A 150000: funded, overfunded 50000. A 100000, X −30000: funded, V 70000. Dec (L 70000, A 0): needed 100000, to go 100000. Dec A 30000: to go 70000 |
| 2 | same, Oct A 50000 (L 50000), Nov A 50000 | funded 50000, to go 50000, underfunded |
| 3 | monthly refill 100000 | Nov L 50000 A 50000: funded 100000, to go 0, funded. A 100000: funded 150000, overfunded 50000. Dec (future, L 70000, A 0): needed 100000, funded 0, to go 100000. Dec A 30000: funded 30000, to go 70000, V 100000. Jan L 100000: to go 100000 |
| 4 | weekly 25000, Saturday | Nov: needed 50000, amount_this_month 100000. A 50000: to go 0, funded. Dec 100000. Jan 125000. Weekly 10000: Nov amount_this_month 40000 |
| 5 | yearly set_aside 1200000 by 2027-10-31 | Nov 100000 (k 12). Nov A 100000: 8%, on_track. Dec 100000 (k 11). Jan 110000 (Dec A 0). Never assigned: Jan 120000 |
| 6 | custom balance 600000 by 2027-04 | Nov 100000. A 150000, X −20000: V 130000, needed 103340, overfunded 46660, 21%. A 100000: to go 3340. A 103330: to go 10. A 103340: on_track. Dec (L 83340): 103340. Jan (L 83340, Dec A 0): 129170. No history: Jan 150000 |
| 7 | custom set_aside 300000 by 2027-01-31; 90000 by 2027-01-15 every 3 months | Nov 100000; Nov 30000 |
| 8 | custom fill_up 80000 by 2026-12-31 | Nov 40000. A 50000: on_track, 62%. Dec (L 50000): to go 30000, due_this_month. Dec A 30000: funded. Jan: complete, needed 0 |
| 9 | custom balance 60000, no date | needed 0, status eventually, overall_to_go 60000 |

## Approach

The work follows `docs/conventions.md`. It adds one new pure core module, one new table, one repository, one
service and one schema file, and extends the month read model. Nothing is registered by hand. No route or MCP
tool file changes: `getPlanMonth` keeps its signature for its callers and reads the clock when no `today` is
given.

### Data: migration `apps/worker/migrations/20261115213604_targets.sql`

| Column | Type | Meaning |
|---|---|---|
| `category_id` | TEXT PK → categories(id) | one target per category |
| `budget_id` | TEXT NOT NULL → budgets(id) | plan scope |
| `cadence` | TEXT NOT NULL | `weekly`, `monthly`, `yearly`, `custom` |
| `behavior` | TEXT NOT NULL | `set_aside`, `refill`, `fill_up`, `balance` |
| `amount` | INTEGER NOT NULL | milliunits, > 0 for every current kind |
| `day_of_week` | INTEGER | 0–6, weekly only |
| `day_of_month` | INTEGER | 1–31, monthly; null = last day |
| `due_date` | TEXT | ISO date: yearly, custom set_aside / fill_up |
| `due_month` | TEXT | first of month: custom balance with a date |
| `repeat_every` | INTEGER | 1–11, custom set_aside / fill_up; null = no repeat |
| `repeat_unit` | TEXT | `month` or `year`, set with `repeat_every` |
| `created_on` | TEXT NOT NULL | ISO date the target was first created (weekly excusing, first month) |
| `created_at`, `updated_at` | TEXT NOT NULL | timestamps; `updated_at` guards concurrent writes |

Index: `targets(budget_id)`. There is no SQL CHECK on `cadence`, `behavior` or `repeat_unit`. As with
`accounts.type`, a forward-only migration cannot relax a CHECK, and later kinds must add values. The values
are enforced by core constants, Drizzle `enum` and Zod. A delete removes the row; `change_log` keeps its last
state. When a category is deleted later (EXF-494), its target is simply never read, because the read model
lists active categories only.

How the next tickets extend it, with additive migrations only:

- **EXF-508** adds the `PUT/DELETE .../categories/{category_id}/target` routes and the
  `set_category_target` / `delete_category_target` tools over `setTarget` / `deleteTarget`. Its request body is
  already `TargetSet` minus the path ids. No table change.
- **EXF-516** adds `ALTER TABLE targets ADD COLUMN snoozed_month TEXT`. The core definition gains
  `snoozed_month` and `computeTargetMonth` returns `status: "snoozed"` when it equals M. The figures stay as
  they are, and consumers exclude snoozed targets from Underfunded and Auto-Assign but not from Cost to Be Me.
- **EXF-538** adds behaviour values (for example `card_payoff` with `cadence: custom` and `due_month`, and
  `card_monthly` with `cadence: monthly` and `amount`). Payoff stores `amount` 0 because its figure comes from
  the card balance. It adds a branch to `computeTargetMonth` with its own inputs (the card balance). It needs no
  new table.

### Core: `packages/core/src/targets.ts` (new, pure)

- Constants `TARGET_CADENCES`, `TARGET_BEHAVIORS`, `TARGET_STATUSES`, `REPEAT_UNITS`, and their types.
- `TargetDefinition` (snake_case, the same shape as the API): `{ cadence, behavior, amount, day_of_week,
  day_of_month, due_date, due_month, repeat: { every, unit } | null, created_on }`.
- `TargetMonth` (read-model object): `{ definition, status, needed_this_month, amount_this_month, funded,
  to_go_this_month, overall_to_go, overfunded, percent, due_this_month, period_due_date }`.
- `computeTargetMonth(def, ctx): TargetMonth | null`, where `ctx = { month, today, leftover, assigned,
  activity, available, assignedIn(month) }`. It returns null for months before `createdMonth`.
- Helpers, exported and unit-tested: `ceilCent(n, k)`, `countWeekdays(month, dayOfWeek, fromDate?)`,
  `targetPeriod(def, month)` → `{ dueDate, dueMonth, startMonth, monthsRemaining } | "complete" | null`.

### Engine: `packages/core/src/budget-engine.ts` (extended, additive)

- `EngineInput` gains optional `targets?: EngineTarget[]` (`TargetDefinition & { categoryId }`) and
  `today?: string`. Existing callers compile unchanged.
- `MonthCategoryDetail` gains `target: TargetMonth | null`. `computeMonth` calls `computeTargetMonth` with the
  category's state for M and `assignedIn = (m) => assignedByCatMonth.get(m|C) ?? 0`. With no target the field is
  `null`. If `targets` is non-empty and `today` is missing, it throws `RangeError`. `computeMonths` (the
  summaries) does not change.

### Schemas: `packages/schema/src/targets.ts` (new) and `months.ts`

`TargetCadence`, `TargetBehavior`, `TargetStatus`, `TargetRepeat`, `TargetDefinition`, `CategoryTargetMonth`,
`Target` (`TargetDefinition` + `budget_id`, `category_id`, `created_month`), `TargetSet` (input, with the
EXF-508 combination rules) and `TargetDelete`. `MonthCategoryDetail` gains
`target: CategoryTargetMonth.nullable()`. The `_sameShape` check in `services/months.ts` keeps the core and API
types identical.

### Services

- `setTarget(env, actor, input: TargetSet, opts?: { today?: string }): Promise<Target>`. It validates input and
  checks that the plan and the category are active and in the same plan (`NotFound`). It creates the target or
  replaces it, keeping `created_on`. A new target gets `created_on = opts.today ?? todayUtc()`. The write is one
  batch: a guarded `change_log` row (`create` or `update`, entity `target`, id = category id, before/after =
  `Target`) followed by the guarded upsert. A lost race retries up to 5 times, then throws `Conflict`.
- `deleteTarget(env, actor, input: TargetDelete): Promise<void>`. It throws `NotFound("Target")` when the
  category has no target. The batch is a guarded `change_log` row (`delete`, before = `Target`, after = null)
  followed by a guarded delete.
- `getPlanMonth(env, budgetId, month, today = todayUtc())` loads the plan's targets and passes them with
  `today` to the engine. `listPlanMonths` does not change.

### REST and MCP

`GET /api/v1/budgets/{budget_id}/months/{month}` and `get_plan_month` return each category with `target`. Both
call the same service, so their output is the same. No path, tool or route file is added.

## Downstream effects

- EXF-514 (display), Underfunded / Auto-Assign (EXF-519) and Cost to Be Me read `target` from the month read
  model. Underfunded uses `to_go_this_month` where the status is `underfunded`. Cost to Be Me adds up
  `amount_this_month`. Reduce Overfunding uses `overfunded`.
- EXF-475 and the Plan grid get one new nullable field per category. Every existing field keeps its meaning.

## Out of scope

- Any UI: nothing under `apps/web/`.
- Target routes, MCP write tools and the form (EXF-508).
- Snooze (EXF-516) and credit card targets (EXF-538).
- `GET .../months/{month}/categories` and `get_month_categories`, which the Lead replaced with fields on the
  existing read model.
- Changes to `budgets` files, `services/accounts.ts`, `services/transactions.ts`, the expected path and tool
  lists, or any `paths.always_overlap` file.

## Acceptance

Every check runs through `pnpm check`, plus `pnpm e2e` at the final gate. No case compares with the source:
there is no screen, and the examples were observed by discovery.

1. **Pure examples.** `packages/core/test/targets.test.ts` calls `computeTargetMonth` for every row of the
   Worked examples table (created_on 2026-11-15, today 2026-11-15). The months are Nov 2026, Dec 2026 and Jan
   2027, with the stated L / A / X / V and `assignedIn`. It asserts the listed `needed_this_month`, `funded`,
   `to_go_this_month`, `overfunded`, `percent`, `status`, `amount_this_month` and `due_this_month`, exactly.
2. **Rounding.** `ceilCent(620000, 6) = 103340`, `ceilCent(516660, 5) = 103340`,
   `ceilCent(516660, 4) = 129170`, `ceilCent(600000, 6) = 100000`, `ceilCent(0, 3) = 0`,
   `ceilCent(-5, 3) = 0`.
3. **Leftover rules.** With L = 50000, A = 0, in Nov (cur) and in Dec (future): monthly set_aside 100000 needs
   to go 100000 in both. Refill needs 50000 in Nov and 100000 in Dec. Fill-up 80000 by 2026-12-31 needs
   ceilCent(30000, 2) = 15000 in Nov. Balance 600000 by 2027-04 in Dec needs ceilCent(550000, 5) = 110000.
4. **Weekly counting.** `countWeekdays("2026-11-01", 6)` = 4, `countWeekdays("2026-11-01", 6, "2026-11-15")` =
   2, Dec = 4, Jan 2027 = 5. A weekly target created 2026-11-29 (Sunday) needs 0 in Nov with status `funded`
   and amount_this_month 4 × W.
5. **Never underfunded.** A no-date balance target gives status `eventually` or `funded` for every L / A / X
   in a generated set (including negative V), and `needed_this_month` 0.
6. **Periods.** For 90000 by 2027-01-15 every 3 months: Feb 2027 has period due 2027-04-15, k = 3, and the
   period starts in Feb. The same target without repeat is `complete` in Feb. Yearly 1200000 by 2027-10-31 in
   Nov 2027 has period due 2028-10-31 and k = 12. A target created 2026-11-15 gives `null` for Oct 2026.
7. **Engine wiring.** `packages/core/test/targets.test.ts` also runs `computeMonth` with the input for example 1
   (Nov A 100000, X −30000; Dec A 30000) and one targetless category. Dec's target has to go 70000 and the
   targetless category has `target: null`. `computeMonth` with a target and no `today` throws `RangeError`. The
   existing `budget-engine.test.ts` is unchanged and passes.
8. **Worker replay.** `apps/worker/test/targets.test.ts` seeds a plan through the services and sets targets with
   `setTarget(..., { today: "2026-11-15" })`. It replays examples 1, 3, 5 and 6 through `setAssigned` and
   `createTransaction`. It reads `getPlanMonth(env, id, month, "2026-11-15")` for Nov, Dec and Jan and asserts
   the same values as case 1. Every amount field is a safe integer.
9. **REST = MCP.** In that plan, REST `GET .../months/2026-12-01` `data` deep-equals `tools/call get_plan_month`
   `structuredContent`, and both deep-equal `getPlanMonth(env, id, "2026-12-01", todayUtc())`. The body parses
   with `MonthDetailResponse`. A category without a target has `target: null`.
10. **History and atomicity.** Creating, replacing and deleting a target leave three `change_log` rows
    (`create`, `update`, `delete`, entity `target`), each with the actor passed and the plan's `budget_id`, and
    with before/after as specified. A replace keeps `created_on`. A `buildSetTargetBatch` call with an invalid
    `change_log` action rejects and leaves no `targets` row.
11. **Validation and errors.** `setTarget` throws `ZodError` for: weekly with `fill_up`; yearly without
    `due_date`; custom balance with `due_date` or `repeat`; custom set_aside without `due_date`; amount 0;
    `day_of_week` 7. It throws `NotFound` for a category from another plan. `deleteTarget` with no target throws
    `NotFound`. A Worker test asserts that core's `TARGET_CADENCES`, `TARGET_BEHAVIORS` and `TARGET_STATUSES`
    equal the schema enums.
12. **Unchanged.** `openapi.test.ts`, `mcp.test.ts`, `e2e/mcp.spec.ts`, `e2e/months.spec.ts`, `months.test.ts`
    and `budget-engine.test.ts` pass with no edit. `schema-drift.test.ts` passes for `targets`.

## Manifest

touches: [packages/core/src/targets.ts, packages/core/src/budget-engine.ts, packages/core/test/targets.test.ts, packages/schema/src/targets.ts, packages/schema/src/months.ts, packages/schema/test/targets.test.ts, apps/worker/migrations/20261115213604_targets.sql, apps/worker/src/db/schema/targets.ts, apps/worker/src/repositories/targets.ts, apps/worker/src/services/targets.ts, apps/worker/src/services/months.ts, apps/worker/test/targets.test.ts, docs/targets-engine-design.md, docs/targets-engine-spec.md, docs/README.md]
shared: [packages/core/src/targets.ts (new) and packages/core/src/budget-engine.ts: the pure target arithmetic, and the engine feeding it and returning `target` per category; additive, every existing field and test unchanged]
migrations: 1

## Credit card payment targets (EXF-538)

A credit card payment category (`kind = credit_card_payment`) takes two target kinds, `card_payoff_by_date` and
`card_monthly`. An ordinary target body on a payment category is still refused (`payment_category_target`), and a
card body on an ordinary category is refused (`card_target_requires_payment_category`).

**Storage, no migration.** The kinds use the existing `targets` columns. The category's `kind` makes the encoding
unambiguous:

- `card_monthly {amount}` is `cadence monthly, behavior set_aside, amount`.
- `card_payoff_by_date {month}` is `cadence custom, behavior balance, due_month = month, amount 0`. An ordinary
  custom balance needs amount > 0, so amount 0 never collides with one.

`Target` (PUT, DELETE and MCP responses) gains `type`: the card kind, or null for an ordinary category. The month
read keeps `CategoryTargetMonth` unchanged. Core and schema keep the same shape (`_sameShape`). The
`change_log` before/after of a target never carries `type` (`targetToApi` is the logged shape, `targetResponse`
adds `type`). The undo engine refuses a target row with a key it does not know, and the encoding above restores a
card target as it was.

**Arithmetic** (`packages/core/src/card-targets.ts`, `computeCardTargetMonth`). `computeMonth` computes the card's
`payment` first and hands its balances to `targetFor`, so no new D1 call is made.

- `card_monthly` is the ordinary monthly set-aside, unchanged.
- `card_payoff_by_date` with B = max(0, -prior_balance) and k = months from this month to the due month, inclusive:
  - needed this month = ceilCent(B / k).
  - funded = Assigned. to go this month = max(0, needed - Assigned).
  - overall To Go = max(0, -current_balance - Available).
  - percent = (B - To Go) / B, 100 when B = 0.
  - Status: To Go 0 is `funded`. Otherwise this month's share met is `on_track`, else `underfunded`.
  - Snoozing changes the status only.
- Ticket example: 1,200.00 over Nov to Feb is 300.00 a month. With 100.00 assigned, 12.00 funded card spending and
  a 100.00 payment: needed 300.00, to go this month 200.00, To Go 1,100.00, 8 %.

**API / MCP.** `PUT .../categories/{id}/target` takes the ordinary body or `{type, month|amount}`; the MCP tool is
`set_card_payment_target`. DELETE and `delete_category_target` work for both.

**UI.** The Payment card's underfunded and overspent states offer Create a Debt Payoff Target. A target replaces
the Payment card with the target view and editor (`CardTargetCard`). The grid pill is cautious with the target
icon while underfunded and a check once funded or on track. Wording and form logic: `packages/schema/src/card-target.ts`.

**Departures from the ticket.**

- D1 The month read has no `type`, and `assigned_so_far` is `funded`. It uses the existing field names.
- D2 No migration (see Storage).
- D3 The "Making minimum payments?" help row is left out.
- D4 The default payoff month is the month after the current one.
- D5 After the due month, the payoff target asks for the whole balance at the start of the month (k = 1). This
  was not observed in the source.
- D6 Payoff percent is (B - To Go) / B. The one observed value, 8 %, fits it.
- D7 Auto-Assign's Underfunded still uses the payment category's Total Underfunded and ignores its target.
- D8 The card target view has no snooze switch. The shift-Z shortcut still snoozes it.
