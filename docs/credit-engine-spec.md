# Credit engine spec (EXF-532, EXF-535)

The design, its decisions and the acceptance cases are in [credit-engine-design.md](credit-engine-design.md).
The tasks are in build order. Each ends with how to check it. Run `pnpm check` after T6 and again at the end.
Run the new spec with `pnpm e2e e2e/credit-overspending.spec.ts`. Delete `.e2e-state` after adding the
migration. Use no new dependency.

## T1 Migration and tables

`apps/worker/migrations/20261116101100_credit_payment_categories.sql`, in this order:
1. `ALTER TABLE category_groups ADD COLUMN kind TEXT`
2. `ALTER TABLE categories ADD COLUMN kind TEXT`
3. `ALTER TABLE categories ADD COLUMN account_id TEXT`
4. `CREATE UNIQUE INDEX category_groups_payment_kind ON category_groups (budget_id) WHERE kind IS NOT NULL AND deleted_at IS NULL`
5. `CREATE UNIQUE INDEX categories_payment_account ON categories (account_id) WHERE account_id IS NOT NULL AND deleted_at IS NULL`
6. **Group backfill.** `INSERT INTO category_groups (<all 10 columns>) SELECT` for each `DISTINCT budget_id`
   of accounts with `type IN ('creditCard','lineOfCredit') AND deleted_at IS NULL` that has no live group with
   `kind = 'credit_card_payments'`:
   - id `<uuid4>`, name 'Credit Card Payments';
   - sort `coalesce(live min sort_order of the plan, 1) - 1`, hidden 0, collapsed 0;
   - created and updated `<now>`, deleted NULL, kind 'credit_card_payments'.
7. **Category backfill.** `INSERT INTO categories (<all 12 columns>) SELECT` for each live credit account with
   no live category whose `account_id` is that account, joined to its plan's live payment group `g`:
   - id `<uuid4>`, `a.budget_id`, `g.id`, `a.name`;
   - sort `(live max sort_order in g, or -1) + row_number() OVER (PARTITION BY a.budget_id ORDER BY a.sort_order, a.id)`;
   - hidden 0, `<now>`, `<now>`, deleted NULL, note NULL, kind 'credit_card_payment', `a.id`.

Definitions:
- `<uuid4>`: `lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))`.
  It must pass `z.uuid()`.
- `<now>`: `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.

Drizzle:
- `db/schema/category-groups.ts`: `kind: text("kind", { enum: ["credit_card_payments"] })`, plus the partial
  unique index (`.where(sql…)`, as in `accounts.ts`).
- `db/schema/categories.ts`: `kind: text("kind", { enum: ["credit_card_payment"] })`,
  `accountId: text("account_id")`, plus its index.

Check: `schema-drift.test.ts`.

## T2 Repositories (categories, category-groups, accounts)

- **Insert statements.** Both `insertIfSortStmt` and `insertIfStmt`, in `repositories/categories.ts` and
  `repositories/category-groups.ts`, select values positionally. Append `${r.kind}` to the group statements,
  and `${r.kind}, ${r.accountId}` to the category statements, in the table's column order. Every row literal
  gets `kind: null` (and `accountId: null`). Those literals are in `services/categories.ts` (four of them) and
  `services/default-categories.ts`.
- **`category-groups.ts`:** `findPaymentGroup(db, budgetId): Promise<CategoryGroupRow | undefined>`.
- **`categories.ts`:**
  - `findPaymentCategory(db, accountId): Promise<CategoryRow | undefined>` (live only).
  - `categoryJson()` and `categoryJsonHidden()` stay as they are. Add `paymentCategoryJson(): SQL`, which is
    `categoryJson()` plus `'kind', kind, 'account_id', account_id`.
- **`accounts.ts`:** add nothing unless the guards in T3 need a helper.

Check: the existing category and group tests pass.

## T3 `apps/worker/src/services/credit-payments.ts` (new)

Exports:
- `PAYMENT_GROUP_NAME = "Credit Card Payments"`.
- `class PaymentLocked extends Error`, with `code: "payment_group_locked" | "payment_category_locked" |
  "payment_category_target"`, the message `PAYMENT_LOCK_TEXT[code]`, and the name "PaymentLocked" (422).
- `PAYMENT_HISTORY_TEXT`.
- `isPaymentGroup(g)` and `isPaymentCategory(c)`, both true when `kind !== null`.
- Builders that return `BatchItem<"sqlite">[]`:
  - `paymentCreateStmts(db, { actor, budgetId, accountId, name, type, now, existingGroup, accountExists })`.
    It returns `[]` unless the type is a credit type.
  - `paymentRenameStmts(db, { actor, budgetId, accountId, name, now, guard })`.
  - `paymentDeleteStmts(db, { actor, budgetId, accountId, now, guard })`.

**Texts.** The texts are fixed:

| Constant | Text |
| -- | -- |
| `payment_group_locked` | The Credit Card Payments group belongs to your credit accounts: it can't be renamed, hidden or deleted, and categories can't be added to it. |
| `payment_category_locked` | A credit card payment category belongs to its account: it can't be renamed, hidden or deleted. Rename, close or delete the account instead. |
| `payment_category_target` | Credit card payment categories can't have a target yet. |
| `PAYMENT_HISTORY_TEXT` (409 `payment_category_has_history`) | This card's payment category has assigned money or transactions. Set its assigned amounts to zero and move its transactions to another category first, or close the account instead. |

**What each builder returns:**
- **`paymentCreateStmts`**
  - When `existingGroup` is undefined:
    1. An insert of a group with a new id G, sort = the plan's live min − 1, kind set, and the guard
       `accountExists AND NOT EXISTS live payment group in plan`.
    2. `changeLogInsertIf(create category_group G, after: {...groupToApi(row), kind})`, guarded on G existing.
  - Always:
    1. An insert-select of the category with a new id. `group_id` is a subquery on the live payment group, and
       `sort_order` is that group's max + 1. The guard is `accountExists` and no live payment category for the
       account. Write it as a raw `db.insert(categories).select(sql…)`, as T2 does.
    2. A `logSelectStmt` with action `create`, entity `category`, and `after` = `paymentCategoryJson()` over
       that row, so the logged `group_id` is the real one.
- **`paymentRenameStmts`:** a `logSelectStmt` (update, before = `paymentCategoryJson()`, after = the same
  with the new name) over the live payment category of the account under `guard`. Then
  `update categories set name, updated_at where account_id = ? and kind is not null and deleted_at is null
  and <guard>`.
- **`paymentDeleteStmts`:** a `logSelectStmt` (delete, after null), then a soft delete under
  `guard AND noHistory(budgetId, [that category])`.

Check: covered by T11.

## T4 Accounts (`services/accounts.ts`, `routes/accounts.ts`, `mcp/tools/accounts.ts`)

- **`insertAccountWithStartingBalance`:**
  - read `findPaymentGroup` before the loop;
  - append `paymentCreateStmts(…, accountExists: g2)` after the Starting Balance's log row;
  - the success test stays `result.meta.changes` of the account insert.
- **`createAccount`** (test seam): also appends `paymentCreateStmts`, guarded on the account existing.
- **`updateAccount`:** when `set.name` is defined and the account is a credit type, put
  `paymentRenameStmts(…, guard: exists accountHolds(before, extra))` **before** the account's log and update.
  The success index moves to the last statement.
- **`deleteAccount`:**
  - for a credit type, read `findPaymentCategory`; when it has history (`categoriesRepo.historyOf` > 0),
    throw `new AccountRefused(PAYMENT_HISTORY_TEXT, 409, "payment_category_has_history")`;
  - otherwise add `paymentDeleteStmts` with the guard
    `accountHolds(before, noOtherTransactions(accountId, null))`, before the account's soft delete;
  - the success test stays on the last statement.
- **`closeAccount` and `reopenAccount`:** unchanged.
- **Tool descriptions:**
  - `create_account` and `create_accounts_from_bank`: "a Credit Card or Line of Credit also gets a payment
    category named like the account in the Credit Card Payments group".
  - `update_account`: "renaming a credit account renames its payment category".
  - `delete_account`: "deleting one removes its payment category, refused (409) while that category has
    assigned money or transactions".
- **Route:** the 409 response description names `payment_category_has_history`.

Check: case 1 and case 2 of the design; `accounts.test.ts` still passes.

## T5 Locks (categories, groups, delete, targets)

- **`services/categories.ts`:**
  - `addCategory` and `createCategory` throw `PaymentLocked("payment_group_locked")` when the group's `kind`
    is set.
  - `updateCategoryGroup` does the same when `kind` is set and `name` or `hidden` changes (collapsed only is
    fine).
  - `updateCategory` throws `payment_category_locked` when `kind` is set and `name` or `hidden` changes
    (a note is fine).
- **`services/category-delete.ts`:**
  - deleting a group with `kind` throws `payment_group_locked`;
  - deleting a category with `kind` throws `payment_category_locked`;
  - `checkTarget` throws `InvalidReassignTarget("reassign_to is a credit card payment category")`.
- **`services/targets.ts` `setTarget`:** a category with `kind` throws `payment_category_target`.
- **Routes:**
  - `categoryError` (`routes/category-groups.ts`) maps `PaymentLocked` to
    `apiError(c, 422, e.code, e.message)`.
  - `routes/targets.ts` maps it the same way in its catch.
  - Add the codes to the 422 response descriptions.
- **Tool descriptions:** add "(not for the Credit Card Payments group or its payment categories)" to
  `create_category`, `rename_category`, `set_category_hidden`, `delete_category`, `rename_category_group`,
  `set_category_group_hidden`, `delete_category_group` and `set_category_target`.

Check: case 3.

## T6 Engine (`packages/core/src/budget-engine.ts`)

Types:
- New: `GroupKind = "credit_card_payments"`, `CategoryKind = "credit_card_payment"` and
  `CategoryState = "ok" | "credit_overspent" | "cash_overspent"`.
- Input, all optional:
  - `EngineGroup.kind?`
  - `EngineCategory.kind?` and `accountId?`
  - `EngineActivity.accountId?` (set on card rows) and `transfer?` (a row of a transfer between two on-plan
    accounts)
- Output:
  - `MonthGroupDetail.kind: GroupKind | null`
  - `MonthCategoryDetail` gains `kind`, `account_id`, `cash_spending`, `credit_spending`,
    `overspent: {cash, credit} | null` and `state`.
- `Classified` gains two variants:
  - `{ kind: "credit"; categoryId; accountId }`: a card row in an ordinary category;
  - `{ kind: "card_transfer"; accountId }`.

  `"category"` now means a cash row, or any row into a payment category.

Functions:
- `classifyTransaction(a, activeIds, paymentIds = new Set())`.
- `splitOverspending(available, creditSpending)`: `{cash, credit} | null`, per rule 2. `creditSpending` is
  signed.
- `splitAcrossCards(credit, spendByCard: ReadonlyMap<id, spend>)`: a `Map` by largest remainder over spend
  > 0, with BigInt products and ties to the lower id.

**Classification order:**
1. `!onBudget` → ignored.
2. `transfer` → `card_transfer` if `accountGroup(accountType) === "credit"` and there is an `accountId`, else
   ignored.
3. inflow → `rta_inflow`.
4. An active category in `paymentIds` → `category`.
5. An active category on a credit row with an `accountId` → `credit`.
6. An active category → `category`.
7. Otherwise → uncategorized.

**`prepare`** keeps three new maps:
- `creditByCatMonth`: `${m}|${cat}` → `Map<accountId, amount>`;
- `transferByCardMonth`: `${m}|${account}` → the sum of **−amount**;
- `paymentCatOfAccount`: accountId → the payment category id (the first by sort).

**`timeline`, per month:**
1. **Ordinary categories:**
   - compute `carried`, `assigned`, `cash` (`catActivity`), the credit map, `activity`, `available`,
     `cash_spending` and `credit_spending`;
   - `overspent = splitOverspending(...)`;
   - `X_K = splitAcrossCards(overspent.credit, s_K)`;
   - add `−credit(K) − X_K` to `funded[K]`.
2. **Payment categories:** `activity = catActivity + funded[K] + transferByCardMonth`; overspent is
   `{cash: −A, credit: 0}` when A < 0.
3. **Overspending:** `MonthState.overspending` = Σ `overspent.cash` + the negative part of Uncategorized.

**`CatState`** carries the new fields.

**Output:**
- Group order: a group with `kind` comes first, then `bySort`.
- `state`: `cash_overspent` if cash > 0, else `credit_overspent` if credit > 0, else `ok`.
- `kind` and `account_id` default to null.
- `computeMonths` is unchanged apart from these internals.
- Update the comment on `classifyTransaction` (the credit rules are now built).

Check: `pnpm --filter @budget/core test`; the existing tests pass unchanged.

## T7 Core tests

**`packages/core/test/credit-engine.test.ts` (new):** design cases 11 and 12, the core replay of steps 1–11,
and examples A, B and C as `EngineInput`s with the `computeMonth` assertions.

**Property test** (same file; a seeded mulberry32 written in the test, no dependency): at least 200 plans.
- **Each plan:** 1–3 cash accounts, 1–3 cards (each with a payment category), an `otherAsset` account, 2–4
  ordinary categories, and 6 months from 2026-06.
- **Each month draws:**
  - assignments, including some in later months;
  - spending and refunds on both kinds of account;
  - inflows to Ready to Assign on both;
  - cash→card payments, card→cash advances and card↔card transfers (both sides `transfer: true`);
  - categorized cash↔tracking rows;
  - uncategorized rows on both, and rows into payment categories from both.
- **Check per month M.** The test keeps its own rows and computes the identity's left side from them. The right
  side comes from `computeMonth(input, M)`:
  - `ready_to_assign`;
  - Σ `available` (hidden included);
  - Σ `overspent.credit`;
  - assignments after M;
  - `uncategorized?.available ?? 0`.
- **Also assert** that each `overspent` part is ≥ 0 and that cash + credit = −available.
- **On failure**, print the seed.

Check: the tests pass. Then break `Funded` (drop `− X_K`) once locally, see the property test fail, and say so
in the build report.

## T8 Activity read and `loadInput`

`repositories/plan-activity.ts` exports `planActivity(db, budgetId, before): Promise<EngineActivity[]>`. It is
`activityByMonth`'s query (live rows on live accounts, `date < before`, no split parents, no card Starting
Balance; build the type list locally, as `transactions.ts` does) with these changes, where
`xfer = t.transfer_account_id is not null and a.on_budget = 1 and coalesce(ta.on_budget, 0) = 1`:
- **Filter:** `not (xfer and a.type not in <CREDIT_ACCOUNT_TYPES>)`.
- **Select:**
  - `categoryId`: `case when xfer then null else t.category_id end`;
  - `accountId`: `case when a.type in <credit types> then a.id end`;
  - `transfer`: `xfer`.
- **Group by** month, those three expressions, inflow, `on_budget` and type.
- `repositories/transactions.ts` is not edited.

In `services/months.ts`, `loadInput` calls `planActivity` instead of `txRepo.activityByMonth`, and passes the
groups' `kind` and the categories' `kind` and `accountId`. `Same<>` must compile.

Check: the months, plan-transactions, splits and transfers tests (the last after T11).

## T9 Schema, Auto-Assign, tool descriptions

**`packages/schema/src/months.ts`:**
- `MonthGroupDetail.kind`: `z.enum(["credit_card_payments"]).nullable()`.
- `MonthCategoryDetail`:
  - `kind`: `z.enum(["credit_card_payment"]).nullable()`
  - `account_id`: `z.string().nullable()`
  - `cash_spending`, `credit_spending`: `Milliunits`
  - `overspent`: `z.object({ cash: Milliunits, credit: Milliunits }).nullable()`
  - `state`: `z.enum(["ok", "credit_overspent", "cash_overspent"])`

**`packages/schema/src/month-totals.ts` `categoryMonth`:** `cash_activity: c.activity - c.credit_spending`,
`credit_activity: c.credit_spending`.

**`packages/schema/src/auto-assign.ts`:**
- add `payment: boolean` to `AutoAssignInput`, and
  `export const PAYMENT_SKIPS: readonly AutoAssignStrategy[] = ["underfunded", "reduce_overfunding", "spent_last_month", "average_spent"]`;
- `autoAssignResult` returns `c.assigned` for a payment input under these strategies;
- `autoAssignPreview` computes `underfunded`, `reduce_overfunding`, `spent_last_month` and `average_spent`
  over `cs.filter(c => !c.payment)`;
- `services/auto-assign.ts` sets `payment: c.kind === "credit_card_payment"`.

**Schema tests:**
- Give the `cat()` and `input()` helpers the new fields in `plan-views`, `month-totals`, `assigned-edit` and
  `auto-assign`.
- Add a `payment` Auto-Assign test and a `categoryMonth` test with credit.

**Tool descriptions:**
- `get_plan_month` (which also names the new fields) and `get_month_category` add: "Credit overspending is
  overspent card spending that becomes card debt and leaves Ready to Assign alone; cash overspending is taken
  from next month's Ready to Assign."
- `preview_auto_assign` and `auto_assign` add: "credit card payment categories are left out of underfunded,
  reduce_overfunding, spent_last_month and average_spent".

`mcp-descriptions.test.ts` must pass without edits. Do not touch the files the brief forbids.

Check: `pnpm check`.

## T10 Web (`apps/web/src/plan/**`)

**Card pill:**
- `icons.tsx`: `CreditCardIcon`, our own 16×16 drawing (a rounded rectangle with a stripe), in
  `currentColor`.
- `AvailablePill`: `PillIcon` adds `"card"`, and the class gains `credit` when the icon is `card`.
- `format.ts`: `overspentPill(c)` is null when `available >= 0`. Otherwise it returns `{tone: "cautious",
  icon: "card"}` for `credit_overspent`, or `{tone: "negative", icon: null}`.
- `rows.tsx` and `CategoryInspector` use `overspentPill(c) ?? (c.target ? targetPill(c) : null)`, keeping
  today's titles.

**Inspector:**
- The lines show `signed(c.cash_spending)` and `signed(c.credit_spending)`.
- A new `panel/overspentMessage.tsx` builds the three sentences of the design word for word: "You've" with an
  ASCII apostrophe, "can’t" with a curly one, and amounts in `<strong>money()</strong>` of positive parts.
- It renders as `<div className="inspector-message {cautious|negative}" role="note">`, the first child of the
  Available Balance card body.

**Payment rows and group:**
- `GroupRow` and `CategoryRow` take `locked` (from `kind !== null`). A locked group has no add-category button
  and its name is a `<span className="group-name">`. Right-click opens nothing.
- `PlanGrid` never opens `edit-group` or `edit-category` for a locked row, including through `editRequest`.
- `CategoryInspector` hides the pencil and `TargetCard` when `c.kind !== null`.
- `DeleteDialog`'s picker gets `include={(c) => c.kind === null}`.

**CSS:**
- `plan-panel.css`: the design's three custom properties in a `:root` block, and `.inspector-message` (radius
  .5em, padding 16px, line-height 1.5, background by tone, colour `--calloutSubtleLabel`, margin-bottom 16px).
- `plan-grid.css`: `.available-pill.credit .pill-icon { fill: currentColor; margin: -1px 0.35rem 0 0 }`.

Check: the existing Plan specs pass.

## T11 Worker tests

- **`apps/worker/test/credit-engine.test.ts`** covers cases 4–10 and 15, through REST:
  - Set Assigned with `PATCH months/{m}/categories/{id}`.
  - Create rows with `POST transactions`: a transfer uses `transfer_account_id`, an inflow uses
    `inflow_to_ready_to_assign: true`.
  - Step 9: `POST months/2026-11-01/categories/{dining}/cover` with `{ from: <groceries> }`, or a `moves` of
    45000.
  - The plan's own `ZZ` group and categories.
  - Assert Nov and Dec after each step, in milliunits, with `state` and `overspent` exact.
  - Case 15 compares `get_plan_month` (through `mcpRpc`) with REST.
- **`apps/worker/test/credit-payments.test.ts`** covers cases 1–3:
  - `change_log` rows: actor, entity, action;
  - each refusal's status and `error.name`, with `change_log` unchanged;
  - MCP tool errors;
  - `apiPaths()` and `listedToolNames()` still list the existing paths and tools.
- **`apps/worker/test/credit-migration.test.ts`** covers case 14. Arrange "before" as the design says, then
  run the `INSERT` queries of the `credit_payment_categories` entry of `env.TEST_MIGRATIONS` twice.
- **`apps/worker/test/transfers.test.ts`:** split "on-plan to on-plan (cash and credit) changes nothing" into
  two tests:
  - cash↔cash changes nothing;
  - cash→card −20000 leaves `rta`, `uncategorized` and every activity unchanged, except the card's payment
    category, which goes to −20000.
- **Before-fix runs.** Run each new test once against the code before its fix, and report that it failed:
  - the engine cases before T6;
  - the lifecycle and lock cases before T4 and T5;
  - the backfill before T1's `INSERT`s.

## T12 E2E

- **`e2e/plan-grid.fixtures.ts`.** `cat()` defaults:
  - `kind: null`, `account_id: null`;
  - `cash_spending: v[2]`, `credit_spending: 0`;
  - `overspent: v[3] < 0 ? { cash: -v[3], credit: 0 } : null`;
  - `state: v[3] < 0 ? "cash_overspent" : "ok"`;
  - `extra` spread last.

  Groups get `kind: null`. `MonthDetailResponse.parse` must pass.
- **`e2e/credit-overspending.spec.ts`** (new) covers cases 17 and 18.
  - **Setup.**
    - Fix the clock: `page.clock.setFixedTime(new Date("2026-11-16T12:00:00"))`.
    - Make a plan through the API (`support/plan-seed.ts` or requests with `authHeaders`).
    - Accounts: "ZZ-TEST Checking" (checking, 100000) and "ZZ-TEST Visa" (creditCard, 0).
    - A group with "ZZ Credit" (assigned 50000), "ZZ Cash" and "ZZ Mixed".
    - Rows dated 2026-11-10: Visa −80000 in Credit; Checking −25000 in Cash; Checking −25000 and Visa −40000
      in Mixed.
  - **Steps.** Open `/${id}/budget`, then check:
    - Credit's pill has `cautious` and `credit`, contains `svg[data-icon="card"]`, and reads "−$30.00".
    - Cash's and Mixed's pills are `negative`, with no card icon.
    - `realClick` each checkbox alone (exact names). `.inspector-message` holds the exact sentence: $30.00;
      $25.00; $65.00 with $25.00.
    - Mixed's lines read "−$25.00" and "−$40.00".
    - The chip reads "3 Overspent".
    - The first `.group-row` is "Credit Card Payments" and has no "Add Category". `realClick` its name: no
      dialog.
    - Select the "ZZ-TEST Visa" row and `realClick` its name: no dialog. There is no
      `Edit category: ZZ-TEST Visa` button and no Target card.
    - Repeat the pill and message checks at 1024×700.
  - **Rules:**
    - use exact names, and `expect.poll` after any request;
    - never write to the database from outside the server;
    - assume nothing about other plans.

Check: `pnpm e2e e2e/credit-overspending.spec.ts e2e/plan-grid.spec.ts e2e/plan-switch.spec.ts e2e/plan-panel.spec.ts`.

## T13 Docs

- `docs/budget-engine-design.md` keeps its one-line pointer under "Credit (EXF-532, EXF-535)" (already
  committed).
- No README docs text changes.

## Done when

- `pnpm check` is green, and the specs of T12 pass.
- The design's cases 1 to 19 are each covered by a named test.
- None of the brief's note-9 files changed. Verify with:
  `git diff --name-only origin/main -- apps/web/src/register apps/web/src/api/transactions.ts apps/web/src/api/accounts.ts apps/worker/src/repositories/transactions.ts apps/worker/src/services/transactions.ts apps/web/src/reflect apps/web/src/shell`
  It must print nothing.
