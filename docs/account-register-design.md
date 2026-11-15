# Account register design (EXF-513)

The `transactions` REST resource and MCP tools (plain cases), and the account page's register: a toolbar and a
sortable table of the account's transactions under the existing header and balances. Spec:
[account-register-spec.md](account-register-spec.md). The Lead's scope notes override the ticket where they
differ.

## Source

Studied live in the plan "Test Budget" on 2026-11-15. The settings were dark theme and a 1600×813 viewport. All
the plan's accounts are closed, so the source draws its toolbar buttons disabled. Notes and screenshots (cropped
right of the 260px sidebar) are in `/workspace/scratch/source/account-register/`: `notes.md`,
`01-checking-default.png`, `03-cleared-tooltip.png`, `06/07-sort-payee-*.png`, `08-selected-row.png` and
`10-tracking-account.png`.

- **Structure**: the register is built from divs with CSS table display, using fixed layout and collapsed
  borders. Only the rows scroll; the toolbar and the header row stay put above them.
- **Toolbar**: 48px tall, background `--backgroundPrimary`, with a 1px top and bottom border
  `rgba(255,255,255,.1)`.
  - The left group starts at padding 8px: "Add Transaction" (plus-circle icon, 16px, in the action colour
    `#a3acff`), "File Import" (document-with-up-arrow icon), a 1×16px divider, then "Undo" and "Redo" (12px
    icons).
  - The right group is "View" with an 8px caret, followed by the search box. The search box is 192×32 with a
    1px border `--inputBorder`, radius 4px and padding-left 28px. It has a 12px magnifier and the placeholder
    "Search <account name>".
  - Buttons: 32px tall, padding 4px 8px, radius 8px, 14px/500, transparent.
- **Header row**: 32px tall, background `--backgroundPrimary`. Labels are 12px/500, uppercase, letter-spacing
  .6px, colour `--labelSecondary`, padding 0 6.4px. Each header cell has a 1px right and bottom border
  `rgba(255,255,255,.1)`.
  - The sorted column's label is 600 weight. Its caret is an 8px triangle at the right end of the cell
    (absolutely positioned, right 8px).
  - OUTFLOW and INFLOW are right-aligned; when one of them is sorted, its label gets margin-right 16px to make
    room for the caret.
  - Column widths: checkbox 36px, flag 42px, image 44px, DATE 96px (6rem), PAYEE 16%, CATEGORY takes the rest,
    MEMO 16%, OUTFLOW 10%, INFLOW 10%, cleared 36px.
  - The cleared header is a 14px "C in a circle" icon with the title "Marking a transaction as 'cleared' means
    it has posted to your bank account.".
- **Rows**: 36px tall, with a 1px bottom border `rgba(255,255,255,.1)` and no vertical borders.
  - Text is 14px/500 `--labelPrimary` with ellipsis. There are no stripes and no hover background (only
    `cursor: pointer`).
  - The date cell reads `11/15/2026`.
  - Money is `$1,234.56` in tabular figures, right-aligned, with padding-right 6.4px. Only one side shows: a
    zero is blank.
  - The category text is plain `--labelPrimary`. "Category not needed" is drawn in `--labelSecondary`.
  - "This needs a category" is an amber pill: background and border `#daac00`, text `#362c05`, radius 24px,
    padding 0 8px, height 22px.
  - The checkbox is a 13px square with a 1px border `#727484` and radius 3px. When ticked, it fills `#545bfe`
    with a white tick, and the row background becomes `#1b1d48`. The header box then shows a minus (partial).
  - Cleared cell: a 12px glyph. Uncleared is the outline "C" in `#727484`; cleared is the filled "C" in
    `#77ba21`; reconciled is a lock in `#77ba21` with `cursor: default`. The aria-label of a cleared row is
    "This transaction is cleared". The tooltip text is as the ticket gives it.
- **Tracking account**: the CATEGORY column is gone, and PAYEE and MEMO share its width (about 400px each at
  1340px).
- **Sorting**: as the ticket says (first click ▼, second ▲, only the active column shows a caret). Same-date
  rows go by signed amount ascending, and the tie order is not reversed when DATE flips. The source also keeps
  earlier clicks as secondary keys and saves them per account in local storage. Budget does not (see Out of
  scope).
- **Not observable** (no credit account, reconciled, uncleared, uncategorised row or empty account): those
  styles come from the source's CSS, as the notes record.

## Approach

Follow `docs/conventions.md`: files only, `(env, actor, input)` services, and one `db.batch` per write with its
`change_log` row.

**No migration.** The read field `updated_at` is derived rather than stored. It is the newest `change_log.created_at`
for the transaction (entity type `transaction`, the same plan), falling back to `created_at`.

A stored column would break `insertIfStmt` (frozen by Lead note 4): Drizzle's `insert().select()` names every
table column, while its SELECT lists the 13 current values by position.

### Schema (`packages/schema/src/transactions.ts`, additive)

`Transaction` and `TransactionCreate` stay as they are: accounts and the engine tests use them. The file adds the
following:

- `TransactionDetail` = `Transaction` plus `category_name`, `category_group_name` (both nullable) and
  `updated_at`. Every response of the new routes uses it.
- `AccountBalances` = `{cleared, uncleared, working}` in milliunits.
- `TransactionCreateRequest` (POST body) takes `account_id`, `date`, `amount`, and optional `payee_name`,
  `category_id`, `inflow_to_ready_to_assign`, `memo`, `cleared` (`uncleared`|`cleared`, default
  `uncleared`) and `approved` (default `true`). The date rules and the "not both a category and the flag"
  rule are the same as for `TransactionCreate`.
- `TransactionUpdateRequest` (PATCH body) has the same fields, all optional, with nullable payee, category and
  memo. At least one key is required.
- The response envelopes are `TransactionResponse` (`{data:{transaction}}`) and `TransactionListResponse`
  (`{data:{transactions, balances}}`).

**Pure register rules (`packages/schema/src/register.ts`, new, unit-tested)** are used by the Worker's list order
and by the web table, so REST, MCP and the UI order rows identically:

- `REGISTER_SORT_COLUMNS = ["date","payee","category","memo","outflow","inflow"]`
- `sortTransactions(rows, column, dir)`
- `categoryLabel(tx, account)`

### API (all under `/api/v1`, Access-protected, idempotency middleware as for every write)

| Method, path | Request | 2xx |
| -- | -- | -- |
| `GET /budgets/{budget_id}/accounts/{account_id}/transactions` | `?since_date=YYYY-MM-DD&sort=date\|payee\|category\|memo\|outflow\|inflow&dir=asc\|desc` (default `date`, `desc`) | 200 `{data:{transactions: TransactionDetail[], balances}}` |
| `GET /budgets/{budget_id}/transactions/{transaction_id}` | | 200 `{data:{transaction}}` |
| `POST /budgets/{budget_id}/transactions` | `TransactionCreateRequest` | 201 `{data:{transaction}}` |
| `PATCH /budgets/{budget_id}/transactions/{transaction_id}` | `TransactionUpdateRequest` | 200 `{data:{transaction}}` (after) |
| `DELETE /budgets/{budget_id}/transactions/{transaction_id}` | | 200 `{data:{transaction}}` (as it was before the delete) |

- **The list** holds the account's non-deleted transactions with `date >= since_date` when given, ordered by
  `sortTransactions`. `balances` always cover the whole account and ignore `since_date`; they equal the
  account resource's `cleared_balance`, `uncleared_balance` and `balance`.
- **Delete** sets `deleted_at`, so the row leaves the list, the balances and the month figures.

**Error answers**: the envelope is `{error:{id,name,detail}}`.

- **404 `not_found`**:
  - an unknown or deleted plan, account or transaction;
  - a transaction of another plan;
  - an account id (in the path, the body or the PATCH) that is not an active account of this plan.
- **422 `unprocessable_entity`**:
  - schema failures (bad date, non-integer amount, unknown key types, an empty PATCH);
  - a category together with the flag (after a PATCH, judged on the merged row);
  - `category_id` that is not an active category of this plan: "Category not found in this plan";
  - a category or the flag on an off-plan account (tracking, or the tests-only loan types): "Tracking
    accounts do not take a category";
  - `cleared: "reconciled"` in a request: "Reconciling is not available here";
  - on a credit account, a row (other than its own Starting Balance) whose payee would be "Starting
    Balance": "This payee name is reserved".
- **409**:
  - `transaction_reconciled` ("This transaction is reconciled") for a PATCH or DELETE of a reconciled row;
  - `starting_balance_locked` ("A credit account's Starting Balance keeps its payee, category and account")
    for a PATCH that changes `payee_name`, `category_id`, `inflow_to_ready_to_assign` or `account_id` of a
    credit Starting Balance.
- **409 `conflict`**: the row changed under five retries.

A credit Starting Balance is a transaction on a `creditCard` or `lineOfCredit` account whose payee is "Starting
Balance", with no category and the flag off: the same test that `activityByMonth` applies. Its amount, date,
memo, cleared and approved fields can still change. The rule protects that engine exclusion until EXF-532, and
the reserved-payee 422 stops other rows from slipping into it.

**MCP** (`mcp/tools/transactions.ts`) uses the same services and the same shapes as the REST `data`. A thrown
refusal becomes an `isError` result carrying the same message.

- `list_transactions {budget_id, account_id, since_date?}` returns `{transactions, balances}`.
- `get_account_balances {budget_id, account_id}` returns `{cleared, uncleared, working}`.
- `create_transaction {budget_id, …TransactionCreateRequest}` returns `{transaction}`.
- `update_transaction {budget_id, transaction_id, …TransactionUpdateRequest}` returns `{transaction}`.
- `delete_transaction {budget_id, transaction_id}` returns `{transaction}`.

### Services (`services/transactions.ts`)

`transactionToApi(row)` and `createTransaction` stay unchanged; tests and accounts use them. The new functions
are `listAccountTransactions`, `getTransaction`, `getAccountBalances`, `addTransaction`, `updateTransaction`
and `deleteTransaction`. Rule failures throw `TransactionRefused(status 409|422, name, detail)`.

- **Create**: check the plan, account and category, apply the rules, then run one batch
  `[insertStmt(row), changeLogInsert(create, after)]` with actor and entity type `transaction`.
- **Update and delete**: read `before`, merge, validate the merged row, then run one batch
  `[changeLogInsertIf(guard), updateIfHoldsStmt(guard)]`.
  - The guard is "the row still has every value read in `before` and is not deleted". A lost race writes
    nothing and is retried (5 attempts, then `Conflict`), as `setAssigned` does.
  - The change_log `before`/`after` are `TransactionDetail` minus `updated_at`.
- **Reads**: join `categories` and `category_groups` for the names (soft-deleted ones included, so old rows
  keep their label). Add the derived `updated_at` from one grouped `change_log` query per plan (list) or per id
  (get).

The repository gains new functions only. `activityByMonth`, `balancesByAccount`, `insertStmt` and
`insertIfStmt` are untouched.

### Web

- **`api/transactions.ts`**:
  - `useAccountTransactions(budgetId, accountId)`, with key `["transactions", budgetId, accountId]`;
  - `useSetCleared(budgetId, accountId)`: a PATCH `{cleared}` with an `Idempotency-Key`. It flips the row in
    the cache optimistically and rolls back on error. When settled, it invalidates every query whose key
    contains `budgetId` (transactions, `["accounts", …]` for the page balances and the sidebar, months).
    `api/accounts.ts` is not edited.
- **`register/`** (new):
  - `Register.tsx` contains `RegisterToolbar` and `RegisterTable`;
  - `icons.tsx` holds Budget's own icons;
  - `register.css` declares the colours that have no token as `--register-*` custom properties at its top.
- **`pages/account.tsx`** only adds `<Register account={account} />` after the balance strip. The header and
  balance strip are unchanged.
- **The toolbar** draws "Add Transaction" (`title="Add new transaction"`), "File Import", a divider, "Undo",
  "Redo", "View" with a caret, and a search box with the placeholder `Search <name>` and the aria-label "Find the
  transactions you're looking for...". None of them has a handler yet; each carries `data-ticket` for its
  ticket (EXF-517, EXF-531, EXF-530, EXF-530, EXF-529, EXF-528). "Link Account" is not drawn.
- **The table** is a real `<table>` with `table-layout: fixed`, a sticky `<thead>` inside a scroll container,
  and an `aria-label` of `<name> transactions`.
  - Columns: checkbox, DATE, PAYEE, CATEGORY (only when `account.on_budget`), MEMO, OUTFLOW, INFLOW,
    cleared. There is no attention, flag, image or balance column. The flag and image widths go to CATEGORY,
    or on tracking accounts to PAYEE and MEMO equally.
  - Each sortable `<th>` holds a `<button>` and has `aria-sort` on the active column.
  - Sort state lives in the component: the default is date desc, and it resets when the account changes. A
    click on an inactive column sorts it desc; a click on the active column flips it.
  - Selection is local (`Set` of ids). A row checkbox toggles that row; the header checkbox selects all or
    none and shows a minus when the selection is partial. It is purely visual (EXF-520).
  - The cleared cell is a `<button>` that sends PATCH `{cleared}` for an uncleared or cleared row. A
    reconciled row's lock does nothing. Its aria-label is "This transaction is cleared|uncleared|reconciled",
    and its `title` is the ticket's tooltip text.
  - States: while loading, the header plus a `role="status"` row "Loading transactions…"; on error, a
    `role="alert"` row "Couldn't load transactions." with a "Try again" button; with no rows, the row "No
    transactions".
- **Formats**: `MM/DD/YYYY` from the ISO date (string slicing, no time zone). Money is `formatMoney(|amount|)`
  in OUTFLOW when the amount is below 0 and in INFLOW when it is above 0; a zero leaves both blank.

## Downstream effects

- **EXF-517** (add/edit inline): attaches to the toolbar's Add Transaction (`data-ticket="EXF-517"`) and to row
  clicks in `RegisterTable`. It uses `addTransaction`/`updateTransaction` and `api/transactions.ts`.
- **EXF-520** replaces the local selection Set with real bulk actions. **EXF-528** wires the search input.
  **EXF-529** wires View, adds the flag, image and balance columns, and persists the sort. **EXF-530** wires
  Undo and Redo; **EXF-531** wires File Import.
- EXF-524, 526, 507/510, 522 and 462 add their fields to `TransactionDetail` and the requests.
- **EXF-533** lifts the reconciled refusals for its own route. **EXF-532** drops the Starting Balance lock and
  the reserved payee. **EXF-484** replaces the header and the balance strip.
- **EXF-534** (All Accounts) reuses `RegisterTable` with an ACCOUNT column.

## Out of scope

Splits, transfers, payees/`payee_id`, `flag_color`, `import_id`/`matched`; future-dated (scheduled) handling (any
valid date is accepted and counted); reconciling; the attention, flag, image and running-balance columns;
toolbar actions, inline edit, bulk actions; styled delayed tooltips with key caps (Budget uses `title`); the
persisted multi-key sort chain; the real header and balance tooltips (EXF-484); closed-account behaviour.
Files of other Builds (Lead note 6) are not touched.

## Acceptance

**Clone**: data is created through the API. That means a plan (`ZZ-TEST …`) from `POST /api/v1/budgets` and
accounts from `POST …/accounts`. Open `/{plan}/accounts/{account}` at 1600×813.

**Source** (compare cases): plan "Test Budget", dark theme, 1600×813. Expand the sidebar's CLOSED group and
open "D3 Checking Main" (budget account), or "D3 Tracking Probe" (tracking). Only look and sort; collapse
CLOSED afterwards. The source's buttons are disabled there because the account is closed.

1. **Toolbar and columns (compare).** On a Checking account, the toolbar reads, left to right: "Add
   Transaction", "File Import", "Undo", "Redo", then on the right "View" and a box with the placeholder
   "Search <name>". "Link Account" is absent. The header cells read: checkbox, DATE, PAYEE, CATEGORY, MEMO,
   OUTFLOW, INFLOW, and the cleared "C" icon. DATE shows ▼ and no other column shows a caret. Sizes and
   colours follow the Source section, except for the flag and image columns, which are absent.
2. **Starting Balance.** A new Checking account with balance 500000 shows exactly one row: today's date as
   `MM/DD/YYYY`, payee "Starting Balance", category "Inflow: Ready to Assign", INFLOW "$500.00", OUTFLOW blank,
   and a green filled "C" with the aria-label "This transaction is cleared". The page shows $500.00 + $0.00 =
   $500.00.
3. **Worked example (Worker test).** Start with a Checking account of 500000 and 200000 assigned to Groceries
   this month through `setAssigned`. Each step goes through REST, with the expected (cleared, uncleared,
   working) from both `GET …/transactions` `balances` and `GET …/accounts/{id}`:
   - POST −17340 Groceries gives (500000, −17340, 482660);
   - POST +30000 Groceries gives (500000, 12660, 512660);
   - PATCH the first amount to −20000 gives (500000, 10000, 510000);
   - PATCH the 30000 row `cleared` gives (530000, −20000, 510000);
   - PATCH the −20000 row `cleared` gives (510000, 0, 510000);
   - PATCH it `uncleared` gives (530000, −20000, 510000).

   Then `GET …/months/<this month>` shows Groceries with activity 10000 and available 210000, and
   `ready_to_assign` 300000.
4. **Tracking (compare).** On an Asset account (balance 5000000), there is no CATEGORY header and no category
   cell. PAYEE and MEMO are wider than on a Checking account at the same viewport. Source: "D3 Tracking
   Probe".
5. **Sorting (compare).** Use a Checking account holding the Starting Balance (500000) and, on the same day, the
   rows "ZZ Alpha" −25000, "ZZ Beta" +10000 and "ZZ Gamma" −5000 (memos "m1", "", "m3").
   - Default order: ZZ Alpha, ZZ Gamma, ZZ Beta, Starting Balance (amount ascending).
   - Click PAYEE: ▼ on PAYEE only, order ZZ Gamma, ZZ Beta, ZZ Alpha, Starting Balance.
   - Click PAYEE again: ▲, with the order reversed.
   - Click DATE: ▼ on DATE only, and the default order is back.
   - Click OUTFLOW: ▼, order ZZ Alpha, ZZ Gamma, then the two inflows.
   - Click INFLOW: ▼, order Starting Balance, ZZ Beta, then the outflows.

   The `aria-sort` of the active `<th>` matches the caret. `GET …/transactions?sort=payee&dir=desc` returns
   the same order. Source: click the headers of "D3 Checking Main" and compare the caret's place and the
   weight; then click DATE to restore it.
6. **Cleared toggle.** Add an uncleared −17340 row through the API. Click its "C": the glyph turns green, and
   the page reads Cleared $482.66, Uncleared $0.00, Working $482.66. There is no reload. The sidebar row
   shows $482.66, because clearing leaves the working balance unchanged. Click it again and it is back to uncleared, with Cleared $500.00 and Uncleared −$17.34.
   `change_log` has two `update` rows with the actor `user:…`.
7. **REST = MCP.** `list_transactions` returns `transactions` and `balances` deep-equal to the REST `data` for
   the same account. `get_account_balances` equals `balances`. Rows carry `category_name`, `category_group_name`
   (null for the Starting Balance) and `updated_at` (≥ `created_at`, changed by a PATCH).
8. **History and actors.** Create, update and delete through REST log `create`, `update` and `delete` rows
   with the actor `user:<email>`; through MCP the actor is `mcp:…`. The before/after JSON matches the change. A
   deleted row is gone from the list, its GET is 404, and the balances drop it. `Idempotency-Key` replays a
   POST without a second row.
9. **Refusals.** Each of the following answers as stated and leaves no row and no log:
   - a category from another plan: 422;
   - a category on an Asset account: 422;
   - the flag on an Asset account: 422;
   - a category together with the flag: 422;
   - `cleared: "reconciled"`: 422;
   - PATCH or DELETE of a reconciled row (made with `createTransaction` in the test): 409
     `transaction_reconciled`;
   - on a Credit Card account's Starting Balance, a PATCH of `payee_name`, of `category_id` or of `account_id`:
     409 `starting_balance_locked`, while a PATCH of its `amount`, `memo` or `cleared` succeeds;
   - POST on a credit account with the payee "Starting Balance": 422;
   - an unknown plan, account or transaction, or a transaction id under another plan: 404;
   - PATCH `account_id` to another plan's account: 404;
   - PATCH `account_id` to another account of the same plan: 200, and both accounts' balances move.
10. **Selection.** Ticking a row's checkbox tints that row (`--register-row-selected`). The header box shows a
    minus; ticking the header selects all rows, and ticking it again clears them. Nothing is sent.
11. **States.** If the list request fails (stubbed 500), an alert "Couldn't load transactions." appears with
    "Try again". The page header and balances still render.
12. **Surface / no regressions.** `apps/worker/test/transactions.test.ts` asserts the three new path entries
    with `apiPaths()` and the five tools with `listedToolNames()`. `openapi.test.ts`, `mcp.test.ts`,
    `existing-surface.test.ts` and `e2e/mcp.spec.ts` are unchanged and green. `e2e/accounts.spec.ts` stays
    green unchanged.

## Manifest

touches: [packages/schema/src/transactions.ts, packages/schema/src/register.ts, packages/schema/test/register.test.ts, apps/worker/src/services/transactions.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/test/transactions.test.ts, apps/web/src/api/transactions.ts, apps/web/src/register/**, apps/web/src/pages/account.tsx, e2e/register.spec.ts, docs/account-register-design.md, docs/account-register-spec.md, docs/README.md]
shared: []
migrations: 0
