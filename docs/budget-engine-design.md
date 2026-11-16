# Budget engine and core data model (EXF-485): design

The server-side arithmetic behind the Plan screen: for every month and category, Assigned, Activity and
Available, rollover, cash overspending, and the plan-wide Ready to Assign (RTA) with its breakdown, exposed as
one month read model over REST and MCP. It also creates the core tables (category groups, categories, monthly
assignments, month notes, accounts, transactions) and the write services that later tickets wire to routes.
No UI. Builds on main `4f1fbb3`. Spec: [budget-engine-spec.md](budget-engine-spec.md).

## Source

The ticket's rules and worked example were observed in the source by discovery; they are the specification
and are not re-observed here (the Lead forbids changing anything in the source plan). A read-only capture of
the Plan month view (no clicks) is in `/workspace/scratch/source/budget-engine/notes.md` and `plan-month.png`.
What it confirms for this design:

- Columns are Category / Assigned / Activity / Available; the source's internal name for Assigned is
  `budgeted`. Group rows show subtotals for all three columns.
- "Inflow: Ready to Assign" is not a row in the grid: it is a transaction destination, so modelling it as a
  flag on the transaction (not a category row) matches.
- A month has a free-text note ("Enter a note...").
- The month summary panel shows Left Over from Last Month, Assigned in <Month>, Activity, Available, and
  Assigned in Future Months: the light month list below carries the same totals.
- The RTA breakdown popover was not opened (clicking is not allowed); its lines come from the ticket.

## Rules as built

For category C and month M (a month is its first day, ISO `YYYY-MM-01`; money is integer milliunits):

- `Assigned(C,M)` = the `month_categories` row, missing row = 0. May be negative.
- `Activity(C,M)` = sum of `amount` of counted transactions with `category_id = C` and `date` in M.
- `Carry(C,M)` = `max(Available(C,M-1), 0)`; `Available(C,M)` = `Carry + Assigned + Activity`.
- `CashOverspending(M)` = sum over categories (hidden included) and the uncategorized bucket of
  `max(-Available, 0)`.
- `RTA(M)` = sum of RTA inflows dated on or before the end of M − sum of `CashOverspending(m)` for all m < M −
  sum of Assigned over all months and all active categories.
- Breakdown (each field is its **signed contribution**, so the five fields sum exactly to `ready_to_assign`):
  - `left_over_from_previous` = RTA inflows ≤ end of M−1 − overspending of months < M−1 − Assigned in months ≤ M−1
    (equals RTA(M−1) + Assigned in months ≥ M);
  - `inflows` = RTA inflows dated in M;
  - `cash_overspending_previous` = −CashOverspending(M−1) (≤ 0);
  - `assigned_in_month` = −Assigned in M; `assigned_in_future` = −Assigned in months > M.
- Group subtotals (`assigned`, `activity`, `available`) sum the group's **visible** categories only.
- `carried` on a category is `Carry(C,M)`.

Implicit rules (Lead's note 5), as implemented:

1. **Tracking accounts never count.** Only transactions on accounts with `on_budget = true` count towards
   Activity, RTA inflows, uncategorized and overspending.
2. **Uncategorized.** A counted transaction with `category_id` null and the inflow flag false is uncategorized.
   It feeds `uncategorized` only, never a category. The uncategorized bucket follows the category rules with
   Assigned = 0 (positive available carries, negative counts as cash overspending). `uncategorized` is `null`
   when no counted uncategorized transaction is dated in M and its Available is 0.
3. **Inflow flag wins.** A transaction with `inflow_to_ready_to_assign = true` is an RTA inflow whatever its
   `category_id` (the create service refuses both together).
4. **Credit accounts (cash only for now).** A categorized transaction on a `creditCard` or `lineOfCredit` account
   counts like any on-plan transaction. All classification is one pure function, `classifyTransaction`; the
   credit rules (payment categories, credit overspending) will extend that function and add **new** fields to
   the read model, leaving every existing field's meaning unchanged.
5. **Deleted rows are ignored everywhere.** Soft-deleted groups, categories, accounts and transactions are not
   loaded. A category whose group is deleted counts as deleted. Assignments of a deleted category are ignored. A
   counted transaction whose `category_id` is not an active category is treated as uncategorized, so money that
   moved is never dropped. EXF-494 reassigns history on delete, so this is only a fallback.
6. **Hidden categories still compute**: they appear in the read model (`hidden: true`), their Available carries
   and overspends, and their Assigned counts in RTA. They are left out of group subtotals only. A hidden group
   is still listed, with its categories.
7. **`collapsed`** is a column on the group row, returned in the read model.

Worked example check (`left_over` → RTA): Oct after step 3: 500 − 470 = 30.00. Nov step 4: 1,500 − 25 −
1,125 = 350.00. Step 5: overspending(Oct) = 0, so 375.00. Step 6: Nov 1,500 − 0 − 1,225 = 275.00; Dec left over
1,500 − 0 − 1,125 = 375.00, Dec RTA = 375 − 50 − 100 = 225.00. These match the ticket.

## Approach

Follow `docs/conventions.md`: one file per table, repository, service, route and MCP tool, picked up by the
existing globs. Nothing is registered by hand and no shared module other than `packages/core/src/**` changes.

### Data (one migration, `apps/worker/migrations/20261115203000_budget_engine.sql`)

Booleans are `INTEGER NOT NULL` 0/1 (Drizzle `integer(..., { mode: "boolean" })`). Timestamps are ISO text.

| Table | Columns |
|---|---|
| `category_groups` | `id` PK, `budget_id` → budgets, `name`, `sort_order` INT, `hidden` 0, `collapsed` 0, `created_at`, `updated_at`, `deleted_at` null |
| `categories` | `id` PK, `budget_id` → budgets, `group_id` → category_groups, `name`, `sort_order` INT, `hidden` 0, `created_at`, `updated_at`, `deleted_at` null |
| `month_categories` | `budget_id` → budgets, `month` TEXT, `category_id` → categories, `assigned` INT, `updated_at`; PK (`budget_id`, `month`, `category_id`) |
| `months` | `budget_id` → budgets, `month` TEXT, `note` TEXT null, `updated_at`; PK (`budget_id`, `month`) |
| `accounts` | `id` PK, `budget_id` → budgets, `name`, `type` TEXT, `on_budget`, `note` null, `starred` 0, `closed` 0, `sort_order` INT, `created_at`, `deleted_at` null |
| `transactions` | `id` PK, `budget_id` → budgets, `account_id` → accounts, `date` TEXT, `payee_name` null, `category_id` → categories null, `inflow_to_ready_to_assign` 0, `memo` null, `amount` INT, `cleared` TEXT 'uncleared', `approved` 0, `created_at`, `deleted_at` null |

Indexes: `categories(group_id)`, `categories(budget_id)`, `category_groups(budget_id)`,
`month_categories(category_id)`, `accounts(budget_id)`, `transactions(budget_id, date)`,
`transactions(account_id)`, `transactions(category_id)`.

Where this departs from the ticket and the Lead's lists, and why:

- Table names are plural (`month_categories`, `months`, not `month_category`, `month`), like `budgets`.
- `sort` and `deleted` are stored as `sort_order` and `deleted_at` (soft delete with a timestamp, the
  convention). The API field is still `sort`.
- `categories` also has `budget_id`, so every query and ownership check is scoped by plan without a join.
- Groups and categories have `updated_at`, for the guarded-update pattern the CRUD ticket (EXF-494) will use.
  `month_categories` and `months` have `updated_at` as an audit aid. Accounts and transactions have exactly the
  Lead's columns.
- `transactions.cleared` is TEXT `uncleared | cleared | reconciled` (not a boolean), because the register and
  reconciliation need three states. `approved` is a boolean.
- `accounts.type` has **no SQL CHECK**: forward-only migrations cannot relax a CHECK without rebuilding the
  table. The 13 types are enforced by Drizzle's `enum`, by Zod, and by the core `ACCOUNT_TYPES` constant.

### Engine (`packages/core/src/budget-engine.ts`, pure, no I/O)

Input: groups, categories, assignments (`{ categoryId, month, assigned }`), activity rows (`{ date, amount,
categoryId, inflowToReadyToAssign, onBudget, accountType }`), notes (`{ month, note }`). Activity rows may be
individual transactions or pre-summed per month: the repository sums per (month, category, flag, account
on_budget, account type) in SQL and passes the month's first day as `date`, and the engine gives the same result
either way. One timeline pass runs month by month from the earliest month with data (or the requested month,
whichever is earlier) to the requested month, keeping per-category Available, the running overspending sum and
RTA inflow totals. `assigned_in_future` sums the assignment list directly. `computeMonth` returns the read
model; `computeMonths(input, from, to)` returns one summary per month from a single pass.

### Services (what later tickets call)

Each mutation takes `(env, actor, input)`, parses `input` with its Zod schema (ZodError → 400 when a route
wires it), checks that the plan and every referenced row are active and in the same plan (`NotFound`
otherwise), and runs **one** `db.batch` that holds its row statements and its `change_log` row(s) with `actor`
and `budget_id`.

| Function (file) | Effect | change_log |
|---|---|---|
| `createCategoryGroup` (`services/categories.ts`) | new group, `sort_order` = max + 1 in the plan | create `category_group` |
| `createCategory` (`services/categories.ts`) | new category in a group, `sort_order` = max + 1 in the group | create `category` |
| `setAssigned` (`services/months.ts`) | upsert Assigned(C,M) to an absolute value | update `month_category` |
| `moveMoney` (`services/months.ts`) | `from` −x, `to` +x in M; `null` side = RTA (only one row changes) | one update `month_category` per changed row |
| `setMonthNote` (`services/months.ts`) | upsert the month's note (`null` clears) | update `month` |
| `createAccount` (`services/accounts.ts`) | minimal account; caller gives `on_budget` | create `account` |
| `createTransaction` (`services/transactions.ts`) | one transaction | create `transaction` |
| `getPlanMonth`, `listPlanMonths` (`services/months.ts`) | read model / summaries | none |

`moveMoney` writes `assigned = assigned + delta` with an upsert, so concurrent moves never lose an update.
`month_category` entity ids are `<category_id>:<month>`; `month` entity ids are the month.

### REST (`apps/worker/src/routes/months.ts`, tag `Months`)

- `GET /budgets/{budget_id}/months/{month}` → `200 { data: MonthDetail }`. `MonthDetail` = `{ month, note,
  ready_to_assign, rta_breakdown: { left_over_from_previous, inflows, cash_overspending_previous,
  assigned_in_month, assigned_in_future }, groups: [{ id, name, sort, hidden, collapsed, assigned, activity,
  available, categories: [{ id, name, sort, hidden, assigned, activity, available, carried }] }],
  uncategorized: { activity, available } | null }`. Groups and categories are ordered by `sort` then `id`.
- `GET /budgets/{budget_id}/months?from=YYYY-MM-01&to=YYYY-MM-01` → `200 { data: { months: MonthSummary[] } }`,
  one per month from `from` to `to` inclusive, where `MonthSummary` = `{ month, note, ready_to_assign, assigned,
  activity, available }`. The totals cover all active categories, hidden included; uncategorized is left out.
  Both parameters are required, with `to ≥ from` and at most 120 months.
- An unknown or deleted plan → 404 `not_found`. A malformed `month`, `from` or `to`, `to < from`, or a range
  over 120 months → 422 `unprocessable_entity` (the route's own validation hook).

### MCP (`apps/worker/src/mcp/tools/months.ts`)

`get_plan_month({ budget_id, month })` returns the same `MonthDetail` object as REST's `data`, from the same
service.

## Downstream effects

- EXF-487 (Plan screen) reads `GET .../months/{month}`. EXF-494, EXF-489, EXF-492 and EXF-493 add routes and tools
  over the services above. EXF-481 and the register tickets extend `accounts` and `transactions` with new
  migrations, and must keep `on_budget` and the inflow flag.
- `mcp.test.ts` and `e2e/mcp.spec.ts` assert the exact tool list: both gain `get_plan_month`. The OpenAPI test
  gains the two paths. Every later Build that adds a tool or path extends those lists.
- Credit rules (a later area) change `classifyTransaction` and add fields; they must not change any field above.

## Out of scope

Any UI (nothing under `apps/web/`). Write routes and MCP write tools. Category update, delete and reassign
(EXF-494). Account and transaction CRUD beyond the minimal creates. Credit card payments and credit
overspending. Targets, age of money, undo. Edits to the existing `budgets` files or to `paths.always_overlap`.

## Acceptance

All checks run through `pnpm check` (unit and Worker tests) and `pnpm e2e` (production bundle). No case
compares with the source app: there is no screen, and the worked example was already observed by discovery.

1. **Worked example, pure.** `packages/core/test/budget-engine.test.ts` builds the example's input step by step
   (one cash on-plan account, Rent, Groceries and Fun in one group). After step 3, Oct is Rent 300000/0/300000,
   Groceries 150000/−100000/50000, Fun 20000/−45000/−25000, group 470000/−145000/325000, RTA 30000. After step 4,
   Nov is Rent 450000/0/750000 (`carried` 300000), Groceries 205000/−60000/195000, Fun 0/−50000/−50000
   (`carried` 0), group 655000/−110000/895000, `cash_overspending_previous` −25000, RTA 350000. After step 5,
   Oct Fun is 45000/−45000/0 and Groceries 125000/−100000/25000, Nov Groceries Available is 170000, the group
   655000/−110000/870000, Nov RTA 375000. In step 6, before assigning, Dec is Rent 0/0/750000, Groceries
   0/0/170000, Fun 0/0/0. After assigning Rent 100000 in Dec, Rent Available is 850000; Dec has
   `assigned_in_month` −100000, `cash_overspending_previous` −50000, `left_over_from_previous` 375000 and RTA
   225000; Nov has `assigned_in_future` −100000 and RTA 275000. In step 7, with a category Target that has Nov
   Assigned 15000, moving Fun's assignment and transactions onto Target and dropping Fun gives Target Oct
   45000/−45000/0 and Nov 15000/−50000/−35000.
2. **Properties** (same file). For several generated inputs and every month from the first to two after the last:
   the five breakdown fields sum to `ready_to_assign`; a category with positive Available in M has `carried` equal
   to it in M+1, and one with negative Available has `carried` 0 in M+1 while M+1's `cash_overspending_previous`
   is minus the sum of the negatives; a move between two categories leaves `ready_to_assign` unchanged in the
   move's month and every earlier month; a move of x from a category to RTA raises `ready_to_assign` by exactly
   x in the move's month and every earlier month. Later months can also change, through cash overspending: the
   step 5 cover raised Nov's RTA.
3. **Implicit rules** (same file). A transaction on a tracking account (`on_budget` false) changes no field of
   any month. An uncategorized outflow of −10000 in M gives `uncategorized` {activity −10000, available −10000}
   in M, no category changes, and M+1's `cash_overspending_previous` is −10000; a month with no uncategorized gives
   `uncategorized: null`. A hidden category with Assigned 5000 is left out of its group's subtotals but lowers RTA
   by 5000. A transaction whose category is not in the input counts as uncategorized. An inflow dated in M+1 does
   not count in M.
4. **Worker replay.** `apps/worker/test/months.test.ts` creates a plan (`ZZ-TEST <random>`), an on-plan cash
   account, a group and three categories through the services, then replays steps 1 to 6 through
   `createTransaction`, `setAssigned` and `moveMoney` (the cover is `moveMoney` from Groceries to Fun in Oct
   for 25000). It reads `GET /api/v1/budgets/{id}/months/{month}` and asserts the values of case 1. Step 7
   reassigns rows with direct SQL (a stand-in for EXF-494) and asserts Target's values.
5. **Moves and RTA through the API.** In the same plan, `moveMoney` between two categories leaves Nov's
   `ready_to_assign` equal to its value before the move; `moveMoney` of 10000 from Rent to RTA (`to` null) in Nov
   raises it by exactly 10000.
6. **History.** Every service call in case 4 leaves `change_log` rows with `actor` equal to the actor passed and
   `budget_id` equal to the plan: one per create, one per `setAssigned`, two for a category-to-category move, one
   for a move to or from RTA, one per `setMonthNote`. An atomicity test runs the `setAssigned` batch with a
   `change_log` entry that breaks the `action` CHECK: the batch rejects and no `month_categories` row exists.
7. **Errors.** `GET /api/v1/budgets/<random uuid>/months/2026-11-01` → 404 `not_found`.
   `.../months/2026-11-15` and `.../months/2026-13-01` → 422 `unprocessable_entity`. `...?from=2026-12-01&to=2026-11-01`
   → 422. `createTransaction` with both `category_id` and the inflow flag → ZodError.
   `createCategory` with a group from another plan → `NotFound`.
8. **REST = MCP; tracking accounts.** `tools/call get_plan_month` for Nov returns `structuredContent` deep-equal to
   REST `data` for Nov. A −99000 transaction on a new tracking account (`on_budget` false), with Groceries as its
   category, leaves the REST month deep-equal to before.
9. **List.** `GET .../months?from=2026-10-01&to=2026-12-01` returns three summaries, Oct to Dec, whose
   `ready_to_assign` equals each month's detail and whose `assigned` equals each month's sum of category Assigned.
10. **Milliunits and months.** All amount fields in cases 4 to 9 are integers (`Number.isSafeInteger`) and every
    `month` matches `^\d{4}-\d{2}-01$`. The `MonthDetailResponse` Zod schema parses the REST body.
11. **Registry.** `apps/worker/test/openapi.test.ts` lists `/api/v1/budgets/{budget_id}/months` and
    `/api/v1/budgets/{budget_id}/months/{month}`. `mcp.test.ts` and `e2e/mcp.spec.ts` list `get_plan_month`.
    `schema-drift.test.ts` passes for the six new tables.
12. **E2E smoke.** `e2e/months.spec.ts` (production bundle): it creates a plan through REST, and
    `GET .../months/<current month>` returns 200 with `ready_to_assign` 0, `groups` [] and `uncategorized` null.
    MCP `get_plan_month` returns the same object. A first-of-month violation returns 422.

## Manifest

touches: [apps/worker/migrations/20261115203000_budget_engine.sql, apps/worker/src/db/schema/category-groups.ts, apps/worker/src/db/schema/categories.ts, apps/worker/src/db/schema/month-categories.ts, apps/worker/src/db/schema/months.ts, apps/worker/src/db/schema/accounts.ts, apps/worker/src/db/schema/transactions.ts, apps/worker/src/repositories/category-groups.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/month-categories.ts, apps/worker/src/repositories/months.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/services/categories.ts, apps/worker/src/services/months.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/transactions.ts, apps/worker/src/routes/months.ts, apps/worker/src/mcp/tools/months.ts, packages/core/src/budget-engine.ts, packages/core/src/account-types.ts, packages/core/test/budget-engine.test.ts, packages/schema/src/categories.ts, packages/schema/src/months.ts, packages/schema/src/accounts.ts, packages/schema/src/transactions.ts, packages/schema/test/months.test.ts, apps/worker/test/months.test.ts, apps/worker/test/openapi.test.ts, apps/worker/test/mcp.test.ts, e2e/mcp.spec.ts, e2e/months.spec.ts, docs/budget-engine-design.md, docs/budget-engine-spec.md, docs/README.md]
shared: [packages/core/src/budget-engine.ts and packages/core/src/account-types.ts (new files in packages/core/src/**): the pure month arithmetic and the account type list every later Plan, account and register ticket reads; no existing core file changes]
migrations: 1

## Credit (EXF-532, EXF-535)

Credit accounts, payment categories, funded card spending and the credit/cash overspending split extend this engine: see [credit-engine-design.md](credit-engine-design.md).
