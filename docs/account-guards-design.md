# Account guards, the Ready to Assign payee, and timestamp formats (design)

Tickets: **EXF-593** (urgent: balance guards that know splits; a closed account takes no new transactions),
**EXF-590** (a payee remembers "Ready to Assign"), **EXF-587** (tool descriptions state timestamp formats).
One Build, one pull request. No migration. Spec: [account-guards-spec.md](account-guards-spec.md).

## Source

Only EXF-593 point 3 has a screen. Study notes and captures:
`/workspace/scratch/source/closed-account-add/notes.md`, `toolbar-closed-normal.png`, `toolbar-closed-add-hover.png`
(cropped to the account toolbar).

- On a closed account's page the toolbar still shows **Add Transaction** in its place, as a native button with
  `disabled` set. Text and icon are `rgb(56, 60, 163)` (`#383ca3`), opacity 1, cursor `default`, and hover
  changes nothing. An enabled toolbar button ("View") is `rgb(163, 172, 255)` with cursor `pointer`.
- Hovering it still shows the usual shortcut tooltip ("Add new transaction" + shift N). The tooltip does not
  mention the closed account.
- **File Import** is disabled the same way. Undo and Redo are disabled too, as they are with nothing to undo.
  View and the search box stay enabled.
- The clone's `.toolbar-button:disabled` already gives `#383ca3` and cursor `default`
  (`plan/plan-grid.css:82`, bundled globally), so `disabled` is enough. No CSS changes.

Everything else here (errors, payee field, descriptions) is judged against the tickets and is not compared.

Architect step in the source (its study sub-agent, Clerk's tab only): expanded the CLOSED group, clicked one
account, hovered Add Transaction with the real mouse, read computed styles of Add Transaction, File Import and
View. No keys, no other clicks. It saved nothing and opened neither the plan menu, nor Bank Connections, nor
Add Account, nor Link Account, nor another plan. Captures kept: the two above; originals deleted.

## EXF-593 part 1: one definition of "a row that counts in an account's balance"

A split is a parent row plus one row per line (`parent_transaction_id` set, same account and date). An account's
balance counts the parent, never the lines. `balancesByAccount` and `openAccountsBalances` say so inline. Three
queries in `repositories/accounts.ts` write their own version without the line rule:
- **`accountSumIs`**: `sum(amount)` over every live row. With a split of -100 (lines -60, -25, -15) and a
  Starting Balance of 1,000, it reads 800 while the balance is 900. The guarded inserts in `adjustBalance` and
  `closeAccount` (`services/accounts.ts:374`, `:474`) then never hold: five attempts, then **409 conflict**.
- **`transactionFacts`**: `count(*)` counts each line as a transaction, which feeds `can_delete` and `closeAccount`'s
  `canDelete`.
- **`noOtherTransactions`** and **`latestReconciledDate`** give no wrong answer today, because a line never
  exists without its parent and shares its date and cleared state. They still write their own condition.

**Change.** `repositories/transactions.ts` exports `countsInBalance(): SQL`, which is
`and(isNull(transactions.deletedAt), isNull(transactions.parentTransactionId))`. Drizzle's `SQL` drops into a
`where(...)` and into a raw `sql\`...\`` template alike, so this one function is both the Drizzle condition and the
raw fragment. It renders the columns as `"transactions"."…"`, exactly as the accounts repository's raw
subqueries already do. Uses:
`balancesByAccount`, `openAccountsBalances`; in `accounts.ts`: `transactionFacts`, `accountSumIs`,
`noOtherTransactions` (both branches), `latestReconciledDate`.

After this, no query in `repositories/accounts.ts` writes `deleted_at is null` or `parent_transaction_id`
for `transactions` itself. (`softDeleteStartingBalanceStmt` is a write on one id and keeps its own
`isNull(deletedAt)` on the target row. A Starting Balance is never a line.) `services/accounts.ts` needs no
change: it reads these functions.

### Readers of `transactions` (every query in `apps/worker/src`)

Per reader: how it treats split lines (L), split parents (P) and both sides of a transfer (T), then the verdict.

| Reader | L | P | T | Verdict |
|---|---|---|---|---|
| `repositories/transactions.ts` `balancesByAccount` | excluded | counted | each side in its account | right; uses `countsInBalance` |
| `… openAccountsBalances` | excluded | counted | both sides (open accounts) | right; uses `countsInBalance` |
| `… activityByMonth` (budget engine) | counted in their categories | excluded (`not exists` live line) | on↔on excluded, on↔tracking counted | right (budget rule, not the balance rule); unchanged |
| `… findDetail` | excluded (a line is not readable alone) | read | each side read by its id | right |
| `… listDetailForAccount`, `listDetailForPlan` | excluded | listed | each side in its account | right |
| `… listLines` | lines only | n/a | n/a | right |
| `repositories/accounts.ts` `accountSumIs` | **counted** | counted | own side | **wrong → fixed** |
| `… transactionFacts` (`can_delete`, Starting Balance id) | **counted** | counted | own side | **wrong → fixed** |
| `… noOtherTransactions` | counted | counted | own side | right in effect; now uses `countsInBalance` |
| `… latestReconciledDate` | counted (same date as parent) | counted | own side | right in effect; now uses `countsInBalance` |
| `… transactionExistsStmt` | by id | by id | by id | right |
| `repositories/payees.ts` `listForPlan` (`last_category_id`) | excluded | excluded | transfer rows have no `payee_id` | right (rule on main); gains the Ready to Assign fact (EXF-590) |
| `repositories/categories.ts` history count, `noHistory` | counted (they carry the category) | not counted (no category) | by category | right |
| `repositories/category-reassign.ts` count, select, update | moved (they carry the category) | untouched (no category) | by category | right |
| `repositories/month-range.ts` `monthFacts` (first month) | counted (parent's date) | counted | both | right (only `min(date)`) |
| `repositories/reports.ts` `earliestTransactionMonth` | counted (parent's date) | counted | both | right; **out of bounds, not edited** |
| `repositories/reports.ts` `monthlySums` (Net Worth) | excluded | counted | each side in its account | right; **out of bounds, not edited** |

No reader outside this Build's files is wrong.

## EXF-593 part 2: a closed account takes no new transactions

New refusals, all **422** with error name **`account_closed`**. Each changes nothing:

| Request | Where it is refused |
|---|---|
| `POST /budgets/{id}/transactions` with `account_id` of a closed account, whether plain, split (`subtransactions`) or transfer | `addTransaction`, right after `activeAccount` and before every other rule |
| `PATCH .../transactions/{id}` with an `account_id` that differs from the row's and names a closed account | `prepare`, where `account` is resolved |
| a new or changed transfer link to a closed account (`POST` or `PATCH` `transfer_account_id`) | `otherAccountOf` with `requireOpen`: same rule as on main, error name changes from `unprocessable_entity` to `account_closed` |
| `create_transfer` / `createTransfer` with a closed `from_account_id` or `to_account_id` | `createTransfer` (from: new check; to: `otherAccountOf`) |

Still allowed, because each edits an existing transaction:
- editing any field of a transaction on a closed account, including turning it into a split;
- deleting a transaction on a closed account;
- keeping the same `account_id`;
- editing an existing transfer whose other account has closed (the rule on main, `prepare` "An existing
  transfer may point at an account closed since").

Moving a transaction *out of* a closed account into an open one is allowed too.

Messages are in the spec. `routes/transactions.ts` `refusals()` already maps `TransactionRefused` to
`{ error: { name: code } }`, and MCP makes a thrown error a tool error with its message: neither changes.

Other paths that write transactions, checked:
- **`adjust-balance`** on a closed account: already refused with 422 `account_closed` (`services/accounts.ts:351`).
- **`close`** writes its own zeroing adjustment *before* the account is closed, in one batch. Unchanged.
- **`POST .../accounts/from-bank`** creates *new*, open accounts with their Starting Balances. A closed
  account is never linked (closing unlinks it), so it cannot touch one. Unchanged.
- **`POST .../accounts/{id}/link`** on a closed account answers 422 `account_not_linkable`
  (`services/account-links.ts:165`, and `linkCondition` requires `closed = false`). It creates no
  transaction. Unchanged.
- `createTransaction` (service helper used only by Worker tests) stays unguarded.

Race: the checks read the account, then write. An account closed between the two is not caught. That is the
same window as the existing other-account check, and a close with a non-zero balance still fails its own
`accountSumIs` guard when a row lands in between. Accepted, not changed.

## EXF-593 part 3: the web side

- `Register` knows the account (`account.closed` from the account read). When it is closed:
  - `RegisterToolbar` renders **Add Transaction** and **File Import** with `disabled` (new prop `closed`). Its
    title stays "Add new transaction".
  - The `shift+N` handler returns before `openAdd()`.
- **All Accounts** add row: the account field already lists only open accounts (`openAccounts` in
  `RegisterTable.tsx:103`). A spec now covers this.
- **Transfer choices** come from the server's payee list, which derives them from open accounts only
  (`services/payees.ts:39`, `transfers.test.ts:404`). A browser spec now covers this.
- **Edit row on All Accounts for a closed account's transaction** (editing stays possible). `EntryRow` resolves
  `chosen` from `openAccounts` only, so it gets `undefined`: the Account field shows empty, and the category
  rule treats a closed tracking account as on-plan. Fix: `chosen` falls back to the full account list
  (`accountsQ.data`). `AccountField` gets an optional `currentName` that it shows when `value` is not among
  `accounts`, and still offers open accounts only.

## EXF-593 part 4 and EXF-587: tool descriptions

`mcp/tool-text.ts` gains:
- `TIMESTAMP = "are ISO 8601 date-times in UTC, for example 2026-11-16T03:29:04.488Z"`, the one sentence part;
- `timestamps(fields: string[], nullable: string[] = []): string`, which gives
  `Timestamps (created_at, last_opened_at) are ISO 8601 date-times in UTC, for example 2026-11-16T03:29:04.488Z.`
  and, when `nullable` is non-empty, ` Timestamps that can be null: last_opened_at.`;
- `dates(...fields: string[]): string`, which gives `Dates (date, since_date) are YYYY-MM-DD.`

`DATE` stays exported unchanged for files this Build may not edit. No tool in this Build's files uses it after
the change.

Each tool whose result holds a timestamp uses `timestamps(...)`. Each in-bounds tool that said
`Dates are YYYY-MM-DD.` uses `dates(...)`, naming its date inputs and the date fields it returns. Expected (the
test is the authority):

| Tool file | Timestamps (nullable in bold) | Dates |
|---|---|---|
| `budgets.ts` (5 tools) | created_at, last_modified_on, **last_opened_at** | none |
| `bank-connections.ts` (4) | last_synced_at, last_reset_at, created_at if returned, balance_updated_at (in accounts) | none |
| `transactions.ts` (7; `get_account_balances` returns none) | updated_at, created_at if returned | date, since_date (inputs) |
| `accounts.ts` (12) | created_at; adjust/close/delete also `updated_at` of the returned transaction | today, import_start_date, date where used |

- `create_transaction`, `update_transaction`, `create_transfer` also say that a closed account is refused
  (text in spec T6). `list_payees` explains `last_inflow_to_ready_to_assign` and the system payees (below).

**The test**, `apps/worker/test/mcp-timestamps.test.ts` (new; `mcp-descriptions.test.ts` is not edited), is
driven by what the tools return. It seeds a plan (accounts, a split, a transfer, an opened plan, a bank
connection row with `last_synced_at`), then calls every listed tool through MCP `tools/call`. The tools are
listed in `CALLS`, and the rest in `NOT_CALLED` with a reason; a new tool must go in one of the two. It walks
each JSON result for string values that parse as an ISO 8601 date-time with a time part. Every such key (and
the same key when it is `null`) must be named in that tool's `Timestamps (…)` list, and a `null` one in its
`can be null` list. Tools in out-of-bounds files go in `HELD` (expected empty: the `months.ts` and `reports.ts`
schemas have no timestamp). Full rules: spec T7.

`docs/conventions.md` gains one appended paragraph: a tool returning timestamps uses `timestamps()`, and a new
tool adds its line to `CALLS` or `NOT_CALLED` in `mcp-timestamps.test.ts`.

## EXF-590: a payee that remembers "Ready to Assign"

- `Payee` (`packages/schema/src/payees.ts`) gains `last_inflow_to_ready_to_assign: z.boolean()`: true when the
  payee's latest counted transaction is an inflow to Ready to Assign; `last_category_id` is then null. "Latest
  counted" is the rule on main (not deleted, not a split line or parent; `date desc, created_at desc, id desc`).
- **System payees** and the transfer entries always read `false`; their `last_category_id` is unchanged (null).
- `repositories/payees.ts` `listForPlan`: one shared fragment picks the latest row's id; the category and the
  flag are read from that row (flag 0 for a system payee). `PayeeListRow.lastInflowToReadyToAssign`,
  `payeeToApi(row, lastCategoryId, lastInflow = false)`. No route change.
- `list_payees` says, in plain words: what each of the two fields means and that the pair (null, true) is
  "Ready to Assign" while (null, false) is no remembered category; split transactions do not count; **system
  payees** are included, marked by a non-null `system`, set by the app and refused as `payee_id` for a new
  transaction (tool error), and listed so that every transaction's `payee_id` resolves.
- **Web.** `entryDraft.ts` exports `rememberedCategory(p): CategoryValue | null` (category, else `{kind:"rta"}`
  when the flag is true, else null). `EntryRow.fillCategory` and `SplitLines` (lines take `rta`,
  `entryDraft.ts:91`) use it with today's guards: only when the category is `none` and the row takes one.
  Picker click and Tab both reach `onPicked`. Inflow/outflow fields are untouched.

## Out of scope

Shortcut-tooltip styling of toolbar buttons (the clone uses `title`, open or closed); Undo/Redo/File Import
behaviour; a race-free closed-account refusal; EXF-515 history rules; anything in the Lead's note 9.

## Acceptance

Worker cases have Worker tests. The Tester runs REST cases with `curl` against `pnpm dev`, browser cases with a
real mouse (`realClick`) at the default viewport and at 1024×700. Amounts are milliunits; names start `ZZ-TEST`.

1. **(EXF-593) Split.** Plan; checking account, balance 1000000; `POST .../transactions` a split -100000 with
   lines -60000, -25000, -15000 (categorized). → `GET .../accounts/{id}`: balance 900000, `can_delete: false`.
   `POST .../adjust-balance {"balance":950000}` → 200, `adjustment.amount` 50000, balance 950000, exactly one
   new (Manual Balance Adjustment) row. `POST .../close` → 200, `adjustment.amount` -950000, `closed: true`,
   balance 0.
2. **(EXF-593) Transfer.** As 1 with a transfer of 100000 to a second open account instead of the split →
   900000, +50000, -950000; the other account keeps its +100000.
3. **(EXF-593) `can_delete`.** Starting Balance only → `true`; after a three-line split → `false`
   (`transactionFacts` count 2 in the Worker test); after deleting the split → `true` and `DELETE` succeeds.
4. **(EXF-593) POST on a closed account.** Close an account; `POST .../transactions` plain, split and transfer
   on it → 422, `error.name` `account_closed`, its transaction list unchanged. MCP `create_transaction` → tool
   error whose text contains "closed".
5. **(EXF-593) Browser.** Seed (REST) an open and a closed checking account. Closed account's page: Add
   Transaction and File Import are disabled; a real-mouse click on Add Transaction opens no entry row;
   `shift+N` on the page body opens none; same at 1024×700. All Accounts: `shift+N`, open the Account field →
   the open account is listed, the closed one is not. Payee field: typing the closed account's name shows no
   `To/From <closed>`; the open one's name shows `To/From <open>`.
6. **(EXF-593) Failing before the fix.** Case 1's Worker test run on unchanged `repositories/accounts.ts`
   fails (`adjust-balance` 409); the Implementer pastes the failing lines in its report.
7. **(EXF-593, Lead) Other refusals.** 422 `account_closed`, nothing changed: `PATCH` with `account_id` of a
   closed account; `POST` and `PATCH` with `transfer_account_id` of a closed account; `create_transfer` to and
   from a closed account; `POST` split on a closed account. 200: `PATCH {"memo":"ZZ-TEST m"}` and `DELETE` on a
   transaction of a closed account; `PATCH` memo of a transfer whose other account has closed.
8. **(EXF-593, Lead) Browser, Edit Account with a split.** Seed checking 1000000 with a -100000 split; its page
   → Edit Account: Working Balance `900.00`; fill `950.00`, Save → server balance polls to 950000, register
   shows a $50.00 inflow adjustment. Edit Account → Close Account: "An adjustment transaction will be created
   for -$950.00."; Adjust Balance & Close → account in CLOSED, working balance $0.00, a "Closed Account" row
   of -950000.
9. **(EXF-593) Compare: closed account toolbar.** Source state live: the test plan, CLOSED group expanded, one
   closed account's page, dark theme, window as it is. Clone: a closed account's page. Add Transaction and
   File Import text and icon `rgb(56, 60, 163)`, cursor `default`, no hover background; View
   `rgb(163, 172, 255)`.
10. **(EXF-590) REST and MCP.** `POST` an inflow 250000, `payee_name` "ZZ-TEST Employer",
    `inflow_to_ready_to_assign: true` → `GET .../payees` and `list_payees`: `last_category_id: null`,
    `last_inflow_to_ready_to_assign: true`. A payee whose latest row is categorized → its category, `false`;
    a payee only on a split → null, `false`; Starting Balance, Manual Balance Adjustment and transfer entries →
    `false`. A later categorized row for the employer → that category, `false`.
11. **(EXF-590) Browser.** Account page, payee of case 10: `shift+N`, Tab to Payee, type "ZZ-TEST Emp", Tab →
    Payee "ZZ-TEST Employer", Category "Inflow: Ready to Assign"; Inflow 250, Save → server (polled) has a new
    row with `inflow_to_ready_to_assign: true`, `category_id: null`. Same by real-mouse pick in the list. A
    category chosen before picking the payee is kept.
12. **(EXF-587) Timestamps.** `mcp-timestamps.test.ts` passes and prints how many tools it called and its
    `NOT_CALLED` and `HELD` lists. `tools/list`: `list_budgets` contains `Timestamps (created_at,
    last_modified_on, last_opened_at) are ISO 8601 date-times in UTC` and `can be null: last_opened_at`;
    `list_bank_connections` names `last_synced_at` as nullable; `list_transactions` contains `Dates (date,
    since_date) are YYYY-MM-DD.` and names `updated_at` as a timestamp.
13. **(EXF-587, Lead) `list_payees`** says system payees are included, marked by `system`, and cannot be chosen
    for a new transaction; `GET .../payees` still returns them.
14. **(EXF-593) Descriptions.** `create_transaction`, `update_transaction`, `create_transfer` say a closed
    account is refused.

## Manifest

touches: [apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/payees.ts, apps/worker/src/mcp/tool-text.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/payees.ts, apps/worker/src/mcp/tools/budgets.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/mcp/tools/accounts.ts, packages/schema/src/payees.ts, packages/schema/test/payees.test.ts, apps/worker/test/account-guards.test.ts, apps/worker/test/mcp-timestamps.test.ts, apps/worker/test/payees.test.ts, apps/worker/test/transfers.test.ts, apps/worker/test/splits.test.ts, apps/worker/test/transactions.test.ts, apps/web/src/register/**, e2e/account-guards.spec.ts, e2e/payee-ready-to-assign.spec.ts, e2e/close-account.spec.ts, e2e/payee-picker.spec.ts, e2e/register-entry.spec.ts, docs/account-guards-design.md, docs/account-guards-spec.md, docs/README.md, docs/conventions.md]
shared: []
migrations: 0
