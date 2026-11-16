# Account links design (EXF-461, Worker side)

Links a bank account (a `bank_accounts` row of a Plaid connection) to a plan account in three ways: add the
bank accounts as new plan accounts, link an existing plan account, unlink. The result is REST and MCP only.
**No file under `apps/web/` changes**, and no screen changes. The ticket stays open for its screens.

## Source

**Not compared: the Lead forbids it, and no screen changes.** In this Build no step opens, reads or
captures the source app, because its bank screens show the owner's real banks. There are no study notes.
The rules below come from the ticket's help-page text (EXF-461 "Rules") and from the Lead's scope notes,
which win where the two differ.

## Approach

- The link is stored on the plan account: two new nullable columns, `accounts.bank_account_id` and
  `accounts.import_start_date`. Having one column means a plan account has at most one bank account. A
  partial unique index on `(budget_id, bank_account_id)` means a bank account has at most one plan account
  per plan. Different plans of the same environment may each link the same bank account.
- New service `services/account-links.ts` holds the three use cases, the Plaid type mapping, and the
  statements that unlink accounts when a connection is removed. New route file `routes/account-links.ts`
  (collected by the glob). The three tools go in `mcp/tools/accounts.ts`.
- **Reuse:** `services/accounts.ts` gets one internal helper, `insertAccountWithStartingBalance`, built
  from the body of `addUnlinkedAccount`: the guarded retry loop, the system payee, and the batch of account
  + Starting Balance + change_log. `addUnlinkedAccount` keeps its checks (loan refusal, entered-sign
  conversion) and calls the helper. `from-bank` calls the same helper with a bank link. A linked account is
  therefore an ordinary account: same sidebar group, balances, Starting Balance payee and change_log rows.
- Every write is one `db.batch` with its change_log rows, guarded the way `updateAccount` is guarded (log
  first, guarded UPDATE after it, retry or refuse when it lost a race). The unique index is the backstop.

## Data

Migration `apps/worker/migrations/20261116100600_account_links.sql` (additive; it takes the name the Lead
gave in note 8):

```sql
ALTER TABLE accounts ADD COLUMN bank_account_id TEXT;
ALTER TABLE accounts ADD COLUMN import_start_date TEXT;
CREATE UNIQUE INDEX accounts_bank_account_link ON accounts (budget_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL AND deleted_at IS NULL;
```

There is no foreign key, as with `transactions.payee_id`. Removing a connection clears the column
explicitly (see below). Drizzle `accounts` gains `bankAccountId` and `importStartDate` **as its last two
columns**, plus the `uniqueIndex(...).where(...)`. The two positional `insert ... select` statements in
`repositories/accounts.ts` (`insertIfStmt`, `insertIfSortStmt`) append the two values.

## Interfaces

### Account resource (every read: REST list/get/create/patch, MCP, change_log snapshots)

Three new fields, added in `accountToApi`:

| field | type | value |
|---|---|---|
| `bank_account_id` | uuid \| null | the linked bank account |
| `linked` | boolean | `bank_account_id !== null` |
| `import_start_date` | `YYYY-MM-DD` \| null | first date a later import (EXF-462) may bring in; null when unlinked |

### `POST /api/v1/budgets/{budget_id}/accounts/from-bank`

Body `{ bank_account_ids: string[] (1..50, no duplicates), overrides?: { [bank_account_id]: { name?, type? } }, today?: YYYY-MM-DD }`.
Answers 201 with `{ data: { created: [{ account, starting_balance }] } }`, in the order of `bank_account_ids`.

The whole request is checked before anything is written. If any check fails, nothing is created:

1. Plan missing: 404. Body invalid: 422 (`unprocessable_entity`). This includes an override key that is
   not in `bank_account_ids`, an empty or too long name, an unknown type, and a `today` that is not a
   calendar date.
2. Each id must be a bank account whose connection has the plan's `bank_environment`. Otherwise
   404 `not_found` "Bank account not found". Another environment's bank account is reported exactly as an
   unknown id.
3. The type (mapped, or the override) is `cash`: 422 `account_not_linkable` "A cash account cannot be linked".
4. A bank account already linked in this plan: 409 `bank_account_already_linked` "This bank account is
   already linked to the account "<name>" in this plan".
5. A name (the override, or the bank account's `name` cut to 100 characters) already used in the plan, or
   used twice in the request (ASCII case ignored): 409 `name_taken` "This account name already exists:
   <name>".

After the checks, each bank account gets **one batch** through `insertAccountWithStartingBalance`: the
account (`bank_account_id`, `import_start_date = link date`), the system payee when it is missing, and
the Starting Balance, each with its change_log row. The batches run in order. If a concurrent change
makes a batch lose its guard after the retries (name taken, bank account linked or removed meanwhile), the
request fails with the matching error. Accounts made by earlier batches stay, and they are correct and
complete accounts.

**Starting Balance of a new linked account:** dated the link date. The amount is
`bankBalanceToPlan(bank.type, bank.current_balance)`: the bank's current balance in milliunits, negated
for Plaid types `credit` and `loan` (so what is owed is negative), and 0 when Plaid gave no current
balance. The sign follows the **Plaid** type, not the override, because an override can rename a card but
cannot change what the bank reports. The transaction is cleared and approved, with payee the system
`starting_balance` payee and `inflow_to_ready_to_assign = startingBalanceFeedsReadyToAssign(type)`, so a
checking or savings account's balance goes to Ready to Assign. Loan types are allowed here (unlike manual
Add Account, which still refuses them). Their `on_budget` is `isOnBudget(type)` (false), as for any loan.

### `POST /api/v1/budgets/{budget_id}/accounts/{account_id}/link`

Body `{ bank_account_id: string, today?: YYYY-MM-DD }`. Answers 200 `{ data: { account } }`.

- Plan or account missing: 404. Bank account unknown or of the other environment: 404 "Bank account not found".
- Account type `cash`: 422 `account_not_linkable` "A cash account cannot be linked".
- **Account closed: 422 `account_not_linkable` "A closed account cannot be linked".** Imports into a
  closed account would be invisible. Reopening comes first (decided here).
- Account already linked (to any bank account, the same one included): 409 `account_already_linked`
  "This account is already linked to a bank account. Unlink it first."
- Bank account linked to another account of this plan: 409 `bank_account_already_linked` (text as above).
- Otherwise it sets `bank_account_id` and `import_start_date` in one batch, with one change_log row
  (`update`, `account`, before/after `accountToApi`).

**`import_start_date` for an existing account:** let `D` be the greatest `date` among the account's
active (`deleted_at IS NULL`) transactions with `cleared = 'reconciled'`. Then `D − 3 days` (UTC calendar
arithmetic, e.g. `2026-03-02` → `2026-02-27`). With no reconciled transaction, the link date. No
transaction is created or changed.

### `DELETE /api/v1/budgets/{budget_id}/accounts/{account_id}/link`

No body. Answers 200 `{ data: { account } }`. The call sets `bank_account_id` and `import_start_date` to
null in one batch with one change_log row (`update`, `account`). Every transaction, the connection and the
bank account stay, and the bank account can be linked again. An account that is not linked answers 200
unchanged and writes nothing (DELETE is idempotent). Plan or account missing: 404. Unlink takes no
`today`, because it writes no date.

### `today` (link date)

`from-bank` and `link` accept `today` (`YYYY-MM-DD`, a real calendar date, years 1900–2199: the same rule
as `AccountCreateRequest.date`). It is the owner's local date and becomes the link date. When it is
absent, the Worker's UTC date `new Date().toISOString().slice(0, 10)` is used.

### Bank connection reads

In every `toApi` of `services/bank-connections.ts` (list, get, rename, reset and the change_log
snapshots), `linked_account_id` is the active account of the **plan named by `budget_id`** that links this
bank account, and null otherwise. A link in another plan is not shown. `createBankConnection` passes no
links, so its accounts carry null. The schema description of `linked_account_id` drops "null until linking
exists", and the MCP `FIELDS` text in `mcp/tools/bank-connections.ts` drops "null until accounts can be
linked".

### Removing a connection

At the marked line in `removeBankConnection`, before `deleteAccountsStmt`, the same batch gets:
- one change_log row per account linked to any of the connection's bank accounts, **in any plan**
  (`update`, `account`, `budget_id` = that account's plan, before/after `accountToApi`). Each row is guarded
  on "still linked to that bank account".
- `UPDATE accounts SET bank_account_id = NULL, import_start_date = NULL WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE bank_connection_id = ?)`.

The accounts and their transactions stay. Each account reads `linked: false`.

### MCP (in `mcp/tools/accounts.ts`; same services; actor `mcp:<actor>`)

| tool | input | returns |
|---|---|---|
| `create_accounts_from_bank` | `budget_id, bank_account_ids, overrides?, today?` | `{ created: [{ account, starting_balance }] }` |
| `link_account` | `budget_id, account_id, bank_account_id, today?` | `{ account }` |
| `unlink_account` | `budget_id, account_id` | `{ account }` |

The descriptions use `MONEY` and `DATE`, say what each returns, and state the rules (cash or closed
refused; already linked is an error; another environment's bank account is not found). `list_accounts` and
`get_account` name `bank_account_id`, `linked` and `import_start_date`.

Coverage lines (in `apps/worker/test/mcp-coverage/accounts.ts`):

```
"POST /budgets/{budget_id}/accounts/from-bank": { tool: "create_accounts_from_bank" },
"POST /budgets/{budget_id}/accounts/{account_id}/link": { tool: "link_account" },
"DELETE /budgets/{budget_id}/accounts/{account_id}/link": { tool: "unlink_account" },
```

## Plaid type → plan account type

`planAccountType(type, subtype)`, exported from `services/account-links.ts`. Matching uses lower case and
Plaid's spaced subtypes. The first matching row wins.

| Plaid `type` | Plaid `subtype` | plan type |
|---|---|---|
| depository | checking | checking |
| depository | savings | savings |
| depository | money market, cd, hsa | savings |
| depository | cash management, prepaid, paypal, ebt, any other, null | checking |
| credit | credit card, paypal, any other, null | creditCard |
| loan | mortgage | mortgage |
| loan | auto | autoLoan |
| loan | student | studentLoan |
| loan | any other (home equity, line of credit, consumer, business, …), null | personalLoan |
| investment, brokerage | any | otherAsset |
| other, or any unknown type | any | otherAsset |

An override may set any account type except `cash`, before the account is created. This Build offers no way
to change the type afterwards (PATCH accepts only `starred`).

## What a later screens Build calls ("add as new" after Plaid Link)

1. `POST /api/v1/bank-connections` (exists): returns the connection with `accounts[]` (id, name, mask,
   type, subtype, current_balance, `linked_account_id`).
2. For the checkbox list: rows with a non-null `linked_account_id` show as linked and cannot be selected. The
   proposed type for each row is `planAccountType` (the screen may mirror the table, or show the bank
   type).
3. `POST /api/v1/budgets/{budget_id}/accounts/from-bank` with the ticked ids, any Edit overrides, and
   `today` = the browser's local date.
4. Re-read `GET /api/v1/budgets/{budget_id}/accounts` (sidebar) and the bank connection.

Link existing: `POST .../accounts/{id}/link`. Unlink: `DELETE .../accounts/{id}/link`.

## Downstream effects

- EXF-462 (import) reads `accounts.bank_account_id` and `import_start_date` and imports nothing dated
  before it.
- The web app ignores the new fields for now. The untyped e2e fixture in `sidebar-groups.spec.ts` needs no
  change.
- Loan accounts can now exist through `from-bank`. EXF-482/547 decide loans' details later.

## Out of scope

Every screen (account selection step, Link/Unlink in the account edit, linked icon, linked header);
transaction import; connection statuses; changing a linked account's type; editing the Starting Balance
(the register already does that).

## Acceptance

All cases are Worker tests (`apps/worker/test/account-links.test.ts`) with Plaid stubbed by
`test/plaid-stub.ts` (`stubPlaid`, `seedSandboxCredentials`, `createPlan("sandbox")`) and sentinel
credentials. **The Sandbox connection** is made with `POST /api/v1/bank-connections` against a stub whose
`/accounts/get` returns: `acc-chk` depository/checking current 1250.5, `acc-sav` depository/savings
current 300, `acc-cc` credit/credit card current 420.25, `acc-ln` loan/student current null. `T` is
`2026-03-10`, passed as `today` unless a case says otherwise. No case compares with the source app.

1. `from-bank` with the checking and credit card ids → 201 with two entries. `list_accounts` (MCP) shows
   both with `linked: true`, the right `bank_account_id`, `import_start_date: T`. The types are checking and
   creditCard, and the names are the bank accounts' names.
2. Each new account has exactly one transaction: payee "Starting Balance", with `payee_id` the plan's
   system payee, date T, cleared, approved. The amount is 1250500 for the checking account and −420250 for
   the card. The checking account's transaction has `inflow_to_ready_to_assign: true`, and the month's Ready
   to Assign for T's month includes +1250500. `acc-ln` (no balance) gives a studentLoan account with a
   Starting Balance of 0.
3. `overrides: { acc-sav: { name: "ZZ Rainy Day", type: "checking" } }` → the account is named
   "ZZ Rainy Day" with type checking. An override type `cash` → 422 and no account. An override key not in
   `bank_account_ids` → 422.
4. Existing unlinked checking account (manual create) with a reconciled transaction dated `2026-03-02`
   (made with `createTransaction`, `cleared: "reconciled"`) and a later cleared one: `link` → 200,
   `import_start_date: "2026-02-27"`, transaction count unchanged. A second unlinked checking account with
   no reconciled transaction: `import_start_date: T`. Without `today`: the Worker's UTC date.
5. Linking a cash account → 422 `account_not_linkable`. Linking a closed account (set `closed = 1` with
   `env.DB` in the test) → 422.
6. `DELETE .../link` → 200, `linked: false`, `bank_account_id` and `import_start_date` null. The
   transaction count is unchanged. `GET /bank-connections/{id}?budget_id=` shows that bank account with
   `linked_account_id: null` (it showed the account id before the unlink). Linking it again succeeds. A
   second DELETE answers 200 and adds no change_log row.
7. Linking the already linked checking bank account to another account of the same plan → 409
   `bank_account_already_linked`, with the existing account's name in the detail. Linking an already linked
   account → 409 `account_already_linked`. `from-bank` with an already linked id → 409 and nothing created.
   In a second sandbox plan, `from-bank` with that same id → 201.
8. `create_accounts_from_bank`, `link_account` and `unlink_account` over MCP give the REST results. Their
   change_log rows (`entity_type = 'account'`, the transaction and payee rows for from-bank) have actor
   `mcp:user:tester@localhost`, and the REST rows `user:tester@localhost`. Errors (409, 422, 404) are tool
   errors.
9. With accounts linked in two plans, `DELETE /bank-connections/{id}` → both accounts remain with their
   transactions, `linked: false`, `import_start_date: null`. Each has an `update` change_log row in its own
   plan. The batch is atomic: when Plaid answers a non-gone error (502), nothing changes and the links stay.
10. A production plan (its `bank_environment` is production): `from-bank` and `link` with a sandbox bank
    account id → 404 "Bank account not found", and nothing written (account and change_log counts
    unchanged). Unlink takes no bank account id, so it has nothing to look up. It always clears the account's
    link, including a link left to the other environment after `update_budget` switched the plan's
    environment (test: link in a sandbox plan, switch the plan to production, `DELETE .../link` → 200,
    `linked: false`). An unlink that 404'd here would leave the account stuck linked.
11. Surface: `apiPaths()` contains both new paths; `listedToolNames()` contains the three tools. The
    change_log of `from-bank` has the account, transaction and (first time) payee `create` rows. A
    direct `env.DB` UPDATE that gives a second active account of the plan the same `bank_account_id` fails
    on the unique index `accounts_bank_account_link`.
12. Pure functions: `planAccountType` for every row of the table; `bankBalanceToPlan` gives depository
    125050 → 125050, credit 42025 → −42025, loan 0 → 0 (not −0), null → 0.

## Manifest

touches: [apps/worker/migrations/20261116100600_account_links.sql, apps/worker/src/db/schema/accounts.ts, packages/schema/src/accounts.ts, packages/schema/src/bank-connections.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/services/account-links.ts, apps/worker/src/routes/account-links.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/plaid/amounts.ts, apps/worker/test/mcp-coverage/accounts.ts, apps/worker/test/account-links.test.ts, docs/account-links-design.md, docs/account-links-spec.md, docs/README.md]
shared: []
migrations: 1

`apps/worker/src/plaid/amounts.ts` is outside the Lead's expected list. It gains `bankBalanceToPlan`,
because the Lead asked for the sign to come from `plaid/amounts.ts`. Nothing in note 7 changes, and no
export is added to the transactions or payees files: the reconciled-date query reads the `transactions`
Drizzle table from `repositories/accounts.ts`.
