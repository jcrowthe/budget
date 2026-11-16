# Account guards, the Ready to Assign payee, and timestamp formats (spec)

Design: [account-guards-design.md](account-guards-design.md). Tickets EXF-593 (urgent), EXF-590, EXF-587.
No migration, no new dependency, no file in the Lead's note 9 (Plan/targets, Reflect incl.
`repositories/reports.ts`, `packages/core`, shell, menu-actions, `always_overlap`). Never edit `openapi.test.ts`,
`mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`, `mcp-descriptions.test.ts`, `e2e/mcp.spec.ts`.

Single Worker test file: `pnpm exec vitest run apps/worker/test/<file>.test.ts`. Specs: `pnpm e2e <spec>`.

## T0. The failing test first (EXF-593 case 6)

Create `apps/worker/test/account-guards.test.ts` with acceptance case 1 (REST through `json`/`call` from
`test/helpers.ts`, `account()`/`tool()` from `test/account-helpers.ts`). Run it **before** T1 and keep the failing
output (the `adjust-balance` status 409 against expected 200) for the report. Then do T1.

## T1. One balance condition (EXF-593 point 1)

`apps/worker/src/repositories/transactions.ts`:

```ts
/** A row that counts in an account's balance: not deleted and not a split line. Usable in `where()` and in raw `sql`. */
export function countsInBalance(): SQL
// = and(isNull(transactions.deletedAt), isNull(transactions.parentTransactionId)) as SQL
```

- `balancesByAccount`: `conds = [eq(budgetId), countsInBalance()]` (drop the two `isNull` lines).
- `openAccountsBalances`: same, keeping the `accounts` conditions.

`apps/worker/src/repositories/accounts.ts` (import `countsInBalance` from `./transactions`):

| Function | New condition |
|---|---|
| `transactionFacts` | `conds = [eq(transactions.budgetId, budgetId), countsInBalance()]` |
| `accountSumIs(accountId, amount)` | `... from transactions where accountId = ${accountId} and ${countsInBalance()}) = ${amount}` |
| `noOtherTransactions(accountId, exceptId)` | both branches: `accountId = … and ${countsInBalance()}` (`and id <> exceptId` kept) |
| `latestReconciledDate` | `and(eq(accountId), eq(cleared,'reconciled'), countsInBalance())` |

Leave `softDeleteStartingBalanceStmt` alone: it writes one row by id. Leave `services/accounts.ts` alone.
After this, `grep -n "deletedAt\|deleted_at\|parentTransactionId" apps/worker/src/repositories/accounts.ts`
shows no condition on `transactions` except the one in `softDeleteStartingBalanceStmt`.

Verify: T0's test passes. Add to `account-guards.test.ts`:
- **case 2** (transfer: `POST` with `transfer_account_id`, or MCP `create_transfer`);
- **case 3** (`can_delete` true, then false, then true again after `DELETE` of the split, then
  `DELETE` of the account answers 200);
- a direct repository check: `transactionFacts(getDb(env), bid, aid).get(aid)?.count === 2` with a Starting
  Balance plus one three-line split.

For each write, assert the number of new rows (`GET .../transactions` length +1) and the amount.

## T2. Closed accounts refuse new transactions (EXF-593 point 2)

`apps/worker/src/services/transactions.ts`:

```ts
const closedAccount = (detail: string) => new TransactionRefused(422, "account_closed", detail);
const CLOSED_NO_NEW = "This account is closed: it takes no new transactions";
const CLOSED_NO_MOVE = "A transaction cannot be moved into a closed account";
const CLOSED_OTHER = "The other account of a transfer must be open"; // existing text
```

1. `addTransaction`: right after `const account = await activeAccount(...)`, `if (account.closed) throw
   closedAccount(CLOSED_NO_NEW)`. This covers plain, split and transfer.
2. `createTransfer`: after `const from = await activeAccount(...)`, the same check.
3. `otherAccountOf`: the `requireOpen && other.closed` branch throws `closedAccount(CLOSED_OTHER)` instead of
   `unprocessable(...)`. This covers `POST`/`create_transfer` to a closed account and `PATCH` with a new or
   changed `transfer_account_id`. The rule is unchanged.
4. `prepare` (update): right after `const account = p.account_id ? ... : beforeAccount`, add
   `if (account.id !== before.accountId && account.closed) throw closedAccount(CLOSED_NO_MOVE)`.
   Nothing else in `prepare` changes. Editing (including adding lines, making it a transfer to an open account,
   or moving it *out*) and deleting a closed account's transaction still work.
5. `createTransaction` (test-only helper): unchanged.

Routes and MCP need no change: `routes/transactions.ts` `refusals()` maps `TransactionRefused`, and the MCP
server returns the thrown message as a tool error. Do not edit `services/accounts.ts`, `account-links.ts`,
`transaction-pairs.ts` or `transaction-splits.ts`.

Verify in `account-guards.test.ts` (case 4 and case 7), closing accounts through `POST .../close`:
- 422 with `error.name === "account_closed"`, the transaction list unchanged, for:
  - `POST` plain / split / `transfer_account_id` on a closed account;
  - `POST` with `transfer_account_id` naming a closed account;
  - `PATCH {account_id: closed}`;
  - `PATCH {transfer_account_id: closed}` on a plain row of an open account;
  - MCP `create_transfer` with a closed `to_account_id`, and with a closed `from_account_id`
    (`result.isError === true`, text contains "closed");
  - MCP `create_transaction` on a closed account (`isError`, text contains "closed").
- 200 for:
  - `PATCH {memo}` on a closed account's transaction;
  - `DELETE` of one;
  - `PATCH {memo}` on a transfer whose other account has since been closed.

`transfers.test.ts` checks only the status (422) for the closed link, so it stays green. If an existing test
asserts `unprocessable_entity` for it, change only that assertion to `account_closed`.

## T3. Closed-account sentence in three tool descriptions (EXF-593 point 4)

`apps/worker/src/mcp/tools/transactions.ts`:
- `create_transaction` adds: `A closed account takes no new transaction: creating one on it, or a transfer to
  it, is a tool error (account_closed).`
- `create_transfer` adds: `Both accounts must be open: a closed from or to account is a tool error
  (account_closed).`
- `update_transaction` adds: `A transaction of a closed account can still be changed or deleted, but moving a
  transaction into a closed account, or a new transfer to one, is a tool error (account_closed).`

## T4. The payee remembers Ready to Assign (EXF-590)

- `packages/schema/src/payees.ts`: in `Payee`, after `last_category_id`, add
  `last_inflow_to_ready_to_assign: z.boolean()`. JSDoc: true when the payee's latest transaction is an inflow to
  Ready to Assign (then `last_category_id` is null); always false for system payees and transfer entries.
  `packages/schema/test/payees.test.ts`: add `last_inflow_to_ready_to_assign: false` to the `p()` defaults.
- `apps/worker/src/repositories/payees.ts`:
  - `PayeeListRow = PayeeRow & { lastCategoryId: string | null; lastInflowToReadyToAssign: boolean }`.
  - In `listForPlan`, build one fragment `latestId` (`select t.id from transactions t where t.payee_id =
    payees.id and …` with the same `where`/`order by`/`limit 1` as today), and select:
    - `live`: `(select c.id from categories c where c.id = (select category_id from transactions where id =
      ${latestId}) and c.deleted_at is null)`;
    - `rta`: `case when payees.system is null then coalesce((select inflow_to_ready_to_assign from
      transactions where id = ${latestId}), 0) else 0 end`.
  - Map `lastInflowToReadyToAssign: r.rta === 1`. `last_category_id` must come out identical to today for
    every payee.
- `apps/worker/src/services/payees.ts`:
  - `payeeToApi(row, lastCategoryId = null, lastInflow = false)` sets `last_inflow_to_ready_to_assign`;
  - `listPayees` passes `r.lastInflowToReadyToAssign`;
  - the transfer entries set `false`.
- `apps/worker/src/mcp/tools/payees.ts`, `list_payees` description. Keep the current content and replace the
  `last_category_id` clause; add the system-payee sentence. It must say, in plain words:
  - `last_category_id` (the category of the payee's latest transaction, or null);
  - `last_inflow_to_ready_to_assign` (true when that latest transaction was an inflow to Ready to Assign:
    `last_category_id` is then null, and the pair means "Ready to Assign"; null with false means no remembered
    category). Split transactions do not count as a payee's latest transaction.
  - "System payees (Starting Balance, Manual Balance Adjustment, and the reconciliation adjustment) are always
    included and marked by a non-null system. The app sets them: they cannot be given as payee_id for a new
    transaction (tool error), but every transaction's payee_id can be found in this list."

  No behaviour change to filtering.

Verify: append a `describe("last_inflow_to_ready_to_assign")` to `apps/worker/test/payees.test.ts` with case 10
over REST and `list_payees`. It covers:
- the employer: null, true;
- a categorized payee: its category, false;
- a payee only on a split: null, false;
- Starting Balance and Manual Balance Adjustment (after one `adjust-balance`): false;
- a `transfer:` entry: false;
- after a later categorized row, the employer reads that category and false.

## T5. Web (EXF-593 point 3, EXF-590)

All in `apps/web/src/register/**`.

1. `RegisterToolbar({ name, onAdd, closed = false })`: `disabled={closed}` on the Add Transaction and File
   Import buttons. The titles and the rest of the markup do not change.
2. `Register`:
   - pass `closed={account?.closed === true}`;
   - in the `shift+N` handler, `if (account?.closed) return;` before `preventDefault`;
   - add `account?.closed` to the effect's dependencies.
3. `AccountField`: optional `currentName?: string`. Shown text is
   `typed ?? (accounts.find(...)?.name ?? currentName ?? "")`. The items are still `accounts`, so only open
   accounts are offered.
4. `EntryRow`:
   - `chosen = account ?? (accountsQ.data ?? accounts).find((a) => a.id === draft.accountId)`;
   - pass `currentName={chosen?.name}` to `AccountField`.

   The add row on All Accounts keeps `openAccounts`.
5. `entryDraft.ts`: `export function rememberedCategory(p: Pick<Payee, "last_category_id" |
   "last_inflow_to_ready_to_assign">): CategoryValue | null`. It returns `{kind:"category", id}` when
   `last_category_id` is set, `{kind:"rta"}` when the flag is true, else `null`.
6. `EntryRow.fillCategory`: `const c = rememberedCategory(p); if (draft.category.kind === "none" && c &&
   !noCategory) patch({ category: c });`.
   `SplitLines` `onPicked`: `const c = rememberedCategory(p); if (l.category.kind === "none" && c) onChange(i,
   { category: c });`.

Verify: `pnpm check`, then T8's specs.

## T6. Timestamp and date wording (EXF-587)

`apps/worker/src/mcp/tool-text.ts` (keep `Id`, `MONEY`, `MONTH`, `DATE` as they are):

```ts
export const TIMESTAMP = "are ISO 8601 date-times in UTC, for example 2026-11-16T03:29:04.488Z";
/** "Timestamps (a, b) are ISO 8601 … ." plus " Timestamps that can be null: b." when `nullable` is non-empty. */
export function timestamps(fields: string[], nullable: string[] = []): string;
/** "Dates (a, b) are YYYY-MM-DD." */
export function dates(...fields: string[]): string;
```

`timestamps` throws if a `nullable` entry is not in `fields`. Fields are joined with `", "`.

Apply in the descriptions:
- `budgets.ts`: the 5 tools that return a budget or budgets: `timestamps(["created_at", "last_modified_on",
  "last_opened_at"], ["last_opened_at"])`. `delete_budget` gets it only if its result holds a budget.
- `bank-connections.ts`: append to the shared `FIELDS` text (or each description):
  `timestamps(["created_at"?, "last_synced_at", "last_reset_at", "balance_updated_at"], ["last_synced_at",
  "last_reset_at", "balance_updated_at"])`. Keep exactly the fields the results hold; T7 decides.
- `transactions.ts`:
  - replace each `${DATE}` with `dates(...)`: `date`, plus `since_date` for `list_transactions`, and `date`
    for `create_transfer`;
  - every tool returning transactions adds `timestamps(["updated_at", …])`, including `create_transfer` and
    `delete_transaction`, and `created_at` if the result holds it;
  - `get_account_balances` needs none.
- `accounts.ts`:
  - replace each `${DATE}` with `dates(...)` naming that tool's date inputs and returned dates (`today`,
    `import_start_date`, `date`, as each tool has them);
  - every tool returning an account adds `timestamps(["created_at", …])`;
  - tools returning a transaction (`adjustment`) add its `updated_at` (and `created_at` if present).

Text the T7 test parses (keep it exact): `Timestamps (` + names + `) are ISO 8601 date-times in UTC` and
`Timestamps that can be null: ` + names + `.`

## T7. `apps/worker/test/mcp-timestamps.test.ts` (new)

- **Seed** (in `beforeAll`, through REST/services; Worker tests may write D1 directly):
  - a plan opened with `PATCH .../budgets/{id} {"opened": true}`;
  - a category group and a category;
  - an on-plan checking account and a tracking account;
  - a categorized transaction, a three-line split and a transfer;
  - one `adjust-balance` (creates the Manual Balance Adjustment payee);
  - a `bank_connections` row (same columns as `bank-connections-manage.test.ts:398`, environment matching the
    plan's `bank_environment`) with `last_synced_at` set to an ISO time, and one `bank_accounts` row;
  - a second plan for `delete_budget`.

  Use `test/plaid-stub.ts` where a tool calls Plaid (e.g. `remove_bank_connection`).
- **`CALLS`**: an ordered array `[toolName, (ctx) => args]` covering every tool it can call (mutating and
  deleting ones last, on throwaway rows: a spare account for `delete_account`/`close_account`/
  `reopen_account`, a spare transaction for `delete_transaction`).
  **`NOT_CALLED`**: `Record<string, string>` mapping a tool to its reason.
  **`HELD`**: `Record<string, string>` with the reason "held by another Build", for tools in files this Build
  may not edit whose results hold a timestamp.
- **Tests**:
  1. Every name of `listedToolNames()` is in exactly one of `CALLS` and `NOT_CALLED`; every `NOT_CALLED` and
     `HELD` reason is non-empty.
  2. Call each `CALLS` entry with `mcpRpc("tools/call", …)`. `isError` fails with the tool name and the error
     text. Parse `content[0].text` as JSON.
  3. Walk each result recursively and collect `(key, value)` pairs. A **timestamp key** is any key whose
     string value matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/` and
     `!Number.isNaN(Date.parse(v))` in any result.
  4. The set of timestamp keys contains `created_at`, `updated_at`, `last_modified_on`, `last_synced_at`.
  5. Per called tool not in `HELD`: each timestamp key present in its result (string or null) is named in
     `/Timestamps \(([^)]*)\) are ISO 8601 date-times in UTC/`. Each one that is `null` there is named in
     `/Timestamps that can be null: ([^.]*)\./`.
     The message is `<tool>: name <key> among its timestamps`.
  6. No description from `tools/list` contains `Dates are YYYY-MM-DD.`
  7. A `console.info` line `mcp-timestamps: called N of M tools; not called: …; held: …` for the report.
- A tool of an out-of-bounds file (`months.ts`, `reports.ts`, a future `targets.ts`) that fails test 5 goes in
  `HELD`, and the Implementer tells the Lead. One that cannot be called goes in `NOT_CALLED` with its reason.

## T8. Browser specs

Use the helpers in `e2e/support/account-edit-seed.ts` and `register-seed.ts`. Seed through REST only, and wait
for each write with `expect.poll` before reading the server. Use `realClick` for every click, `{ exact: true }`
names, and `ZZ-TEST` names. Each spec creates its own plan.

`e2e/account-guards.spec.ts` (new):
- **case 5**:
  - closed page: `getByRole("button", { name: "Add Transaction", exact: true })` `toBeDisabled()`, same for
    "File Import";
  - `realClick` the disabled button: zero `.entry-row` within the register;
  - click an empty spot of the page header, `keyboard.press("Shift+N")`: still none;
  - repeat with `page.setViewportSize({ width: 1024, height: 700 })`;
  - All Accounts: `Shift+N`, the account field's list (`listbox` "Accounts") has the open name and not the
    closed one;
  - payee field: type the closed name → no `To/From <closed>` option; type the open name → `To/From <open>`
    visible.
- **case 8**: as the design states, through the Edit Account and Close Account dialogs (`openFromHeader`,
  `dialog`, `dbutton`, the "Working Balance" field). Read balances from the server with `accountData`/
  `getAccount`.

`e2e/payee-ready-to-assign.spec.ts` (new): **case 11**, Tab path and real-mouse pick path, plus "a chosen
category is kept".

Run `close-account.spec.ts`, `payee-picker.spec.ts`, `register-entry.spec.ts`, `all-accounts.spec.ts`,
`splits.spec.ts`, `transfers.spec.ts`. Change an assertion there only if it asserted the old behaviour, and say
which in the report.

## T9. Docs

- `docs/README.md`: one line is already added by the Architect.
- `docs/conventions.md`: append at the end of the file:
  `**Timestamps in tool results.** A tool whose result holds a timestamp names it with timestamps([...],
  [nullable]) from mcp/tool-text.ts, and dates with dates(...). A new tool adds its call to CALLS (or a reason
  to NOT_CALLED) in apps/worker/test/mcp-timestamps.test.ts.`

## T10. Gate

`pnpm check` green. `pnpm e2e e2e/account-guards.spec.ts e2e/payee-ready-to-assign.spec.ts` plus the specs of T8
green with `--repeat-each=3`. If a browser spec cannot launch, run `pnpm exec playwright install chromium`
first.

The report gives:
- the T0 failing output;
- the T7 line (called N of M, not called, held);
- every existing assertion changed;
- confirmation that no file in note 9 changed (`git diff --stat origin/main`).

The source app is not opened by the Implementer.
