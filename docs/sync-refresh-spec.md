# Sync refresh spec (EXF-875 with EXF-751)

Design: [sync-refresh-design.md](sync-refresh-design.md); its acceptance numbers are used below.

Ground rules:

- No migration and no schema file.
- No dependency.
- No file of `paths.always_overlap` except the one cron line.
- No web source file. `e2e/support/real-click.ts` and `e2e/support/manage-connections-seed.ts` are imported, never edited.
- No existing test's expectation is edited without being listed as a departure.
- Commit after each part.
- Run only this Build's tests and specs: `pnpm --filter @budget/worker exec vitest run test/sync-refresh` plus any existing file you touch the code of, `pnpm check`, and `pnpm e2e e2e/sync-refresh.spec.ts e2e/sync-refresh-narrow.spec.ts`.

## Part 1: EXF-751

### 1.1 Failing test first: `apps/worker/test/sync-refresh-schedule.test.ts`

- **Helpers.** Use `beforeEach(setupPlaid)`, `stubBank`, `world`, `world1`, `q`, `planCalls` and `connRow` (`test/plaid-sync-helpers.ts`), and `plaidError` (`test/plaid-stub.ts`).
- **Shared storage.** Storage lasts through the file. Each test asserts only on its own connection id, never on counts of all connections.
- **"every six hours"** (acceptance 2).
  - Setup: `world()`, then `q("update bank_connections set last_synced_at = null where id = ?", conn)`.
  - `run` is a stub: `async (e, c) => { ran.push(c.id); await q("update bank_connections set last_synced_at = ? where id = ?", new Date(at.getTime() + 5000).toISOString(), c.id); return { has_more: false } as never; }`, cast as `typeof requestSync`.
  - Call `syncDueConnections(env, at, run)` with `at` = `2030-03-10T03:00:00Z`, then `09:00:00Z`, then `09:10:00Z`.
  - Expect `ran` to contain `conn` after 03:00 and again after 09:00, and **not** again after 09:10.
  - Run it on the unchanged code and quote the failing line: the 09:00 expectation.
- **"the scheduler enters each due schedule once per day"** (acceptance 3).
  - Make a plan and an account. Use the helpers of `test/scheduled-helpers.ts` (`plan`, `account`, `sched`, `setNext`, `realRows`) to create a **daily** and a **monthly** schedule, each with `date_next` = `2030-03-09`.
  - Run `cronRun(env, new Date("2030-03-10T03:00:00Z"), noRun)`, then the same at 09, 15 and 21. `noRun` returns `{ has_more: false }` and calls nothing.
  - Expect one transaction per schedule dated 2030-03-09 (`realRows`), with the daily schedule's `date_next` at 2030-03-10 and the monthly one's at 2030-04-09.
  - Run `cronRun` at `2030-03-11T03:00:00Z`: the daily schedule has 2 rows (03-09 and 03-10), and the monthly one still has 1.
  - The plan's own rows are the only ones asserted.
- **"a connection that needs a sign-in is checked once a day"** (acceptance 4).
  - Setup: `world1()`, then `update bank_connections set status = 'login_required', sync_error_since = <now-1h>, last_synced_at = <now-48h>`.
  - Stub `/accounts/get` and `/transactions/sync` refusing with `plaidError(400, "ITEM_LOGIN_REQUIRED")`.
  - `run` = `(e, c, o) => runSync(e, c.id, o)`, as in `link-status-check.test.ts`.
  - With `t = new Date()` (the real clock: `checkedStmt` writes the real time), run `syncDueConnections(env, new Date(t + k*6h), run)` for k = 0..4.
  - After each run, count the `/accounts/get` calls whose body names this connection's token. Simpler: set every other connection aside with `update bank_connections set status = 'broken' where id != ?`, as `link-status-check.test.ts` `setAside` does. Expect `[1, 0, 0, 0, 1]`.

### 1.2 The rule

- `packages/schema/src/plaid-import.ts`: add the constant below next to `DUE_AFTER_MS`. Fix the comment at line 70 ("in the nightly run" becomes "in a scheduled run (about once a day)").

  ```ts
  /** Due for the scheduled run (every six hours): five hours, so a run a few seconds late still finds it due. */
  export const SCHEDULE_DUE_AFTER_MS = 5 * 3600_000;
  ```

- `apps/worker/src/services/plaid-sync.ts` `syncDueConnections`: `listDue(getDb(env), new Date(now.getTime() - SCHEDULE_DUE_AFTER_MS).toISOString())`. Update its doc comment ("not synced for five hours; the cron runs every six"). Drop `DUE_AFTER_MS` from the import if unused. `isDue` and `bank-link.ts` are not touched.
- Comments: `plaid-sync.ts` around 204 and 226 ("nightly check" becomes "the scheduled check"); `repositories/bank-connections.ts:166` likewise; `scheduled.ts:9` ("The daily job" becomes "The scheduled job, every six hours (03, 09, 15, 21 UTC)").
- `apps/worker/src/mcp/tools/bank-connections.ts` `FIELDS`: "is checked once a night" becomes "is checked about once a day".

### 1.3 The cron line

`apps/worker/wrangler.jsonc` line 24 becomes exactly `  "triggers": { "crons": ["0 3,9,15,21 * * *"] },`. Check that `git diff origin/main -- apps/worker/wrangler.jsonc` shows that one line and nothing else.

### 1.4 Calls: `apps/worker/test/sync-refresh-cron-calls.test.ts` (acceptance 5)

- Use `countingEnv` (`plaid-sync-helpers.ts`) and a `run` stub that counts.
- Create no schedule in this file, so `enterDue` finds nothing.
- **First test, "nothing due":** set every connection aside (`update bank_connections set status = 'broken'`), then `cronRun(c.env, new Date(), run)`. Expect `{ d1: 3, runs: 0 }`.
- **Second test, "five due":** insert 5 `connected` connections with `last_synced_at` null. Use the raw insert of `scheduled-transactions-calls.test.ts` line ~188, which names its columns. Set every other connection broken. Expect `{ d1: 3, runs: 5 }`, and `stubBank`'s call log empty.
- If the measured D1 count differs, stop and say why in the report; do not just re-pin.

**Verify part 1:** the test files pass, `pnpm check` passes, then commit.

## Part 2: EXF-875 in the Worker

### 2.1 Failing test first: `apps/worker/test/sync-refresh-accounts.test.ts`

- **The stub list.** `listed(...ids)` returns a handler for `/accounts/get` that answers with the chosen accounts in Plaid's shape, as `stubBank` does: `{ item: { institution_id: "ins_109508" }, accounts: [...] }`. The choices are:
  - `acc-chk` ZZ Checking (`0000`, depository/checking);
  - `acc-sav` ZZ Savings (`0000`, depository/savings);
  - `acc-new` ZZ Rewards (mask `4321`, type `credit`, subtype `credit card`, `balances: { current: 50, available: null }`).
- Pass it as `stubBank({ "/accounts/get": listed(...) })` **after** `world()`, so creation still sees two accounts. Calling `stubBank` again replaces the stub; check `stubPlaid`.
- **Reads.** `bankRows(conn)` = `q("select * from bank_accounts where bank_connection_id = ? order by created_at, name", conn)`.
- **Sync.** Use `runSync(env, conn)` (`services/plaid-sync.ts`) or `syncOne(plan, conn)`.

Tests, by acceptance number:

- **7.** With ZZ Checking linked (`world1`) and the list chk, sav, new, one sync gives 3 rows.
  - The new row: `name` ZZ Rewards, `mask` 4321, `type` credit, `subtype` credit card, `current_balance` 50000, `available_balance` null, `balance_updated_at` not null.
  - No `accounts` row has its id.
  - A second sync still gives 3 rows.
  - The same holds for a `world()` connection with no link.
  - **Run it on the unchanged code first and quote the failing line** (`toHaveLength(3)` receives 2).
- **8.** With a `world()` connection (no link), `Promise.allSettled([runSync(env, conn), runSync(env, conn)])` leaves both fulfilled and 3 rows.
  - Also, with `getDb(env)`, `db.batch([insertAccountIfStmt(db, rowA, guard), insertAccountIfStmt(db, rowB, guard)])`, where both rows have the same `plaidAccountId` and different ids, gives `meta.changes` `[1, 0]`.
- **9.** List chk and sav, with sav renamed "ZZ Savings Plus" and mask `9999`. One sync changes the sav row's name and mask.
  - Count `change_log` rows (`logCount()`) and read the row's values.
  - A second sync with the same list changes no `bank_accounts` value and adds no change_log row.
- **10.** Three cases, each on a fresh world:
  - The list is chk only, with sav unlinked: the sav row is gone.
  - With `world1` (chk linked), the list is sav only: the chk row stays, and the plan account's `link_missing_since` is not null (`GET …/accounts/{id}`).
  - `listed()` (empty, with a good answer): both rows stay.
- **11 Relink.** With `world1` and the list sav, new: one sync marks the plan account missing and adds acc-new.
  - `json(\`${A(plan)}/${account}/link\`, { method: "POST" }, { bank_account_id: <acc-new row id> })` answers 200 with `link_missing_since: null`. Check the exact path in `routes/` (it is the one `link-status-not-found.test.ts` uses).
  - Next sync, same list: `link_missing_since` is still null, and the old acc-chk row is gone (unlinked and unlisted).
- **12 After reset.** Use `world1` and set the connection to `login_required` with `sync_error_code = 'INVALID_MFA'`. List chk, sav, new.
  - `POST /api/v1/bank-connections/{id}/reset?budget_id=` (read its route for the exact path and body; see `bank-connections-manage.test.ts`), then `syncOne`.
  - `GET /api/v1/bank-connections?budget_id=` lists ZZ Rewards with `linked_account_id: null`.
  - The MCP tool `list_bank_connections` returns it too. Use the MCP helper the other tool tests use, e.g. `connection-status-mcp.test.ts`.
- **14.** With a connected `world()` and the list chk, sav, new: `logCount("bank_connection")` is the same before and after the sync.

### 2.2 One mapping

- **`apps/worker/src/plaid/transactions.ts`**, a type only:

  ```ts
  /** One account of Plaid's /accounts/get answer. */
  export interface PlaidAccount {
    account_id: string; name: string; mask?: string | null; type: string; subtype?: string | null;
    balances: { current?: number | null; available?: number | null; last_updated_datetime?: string | null };
  }
  export type BalanceAccount = PlaidAccount;
  ```

  `fetchBalances` keeps its body.
- **`apps/worker/src/services/bank-connections.ts`:**
  - Delete the local `PlaidAccount` and import it from `../plaid/transactions`.
  - Add the function below, the code now at lines ~145-157 moved as is:

    ```ts
    /** A bank account row from Plaid's account (at creation and when a sync finds a new one). */
    export function bankAccountRow(connectionId: string, a: PlaidAccount, now: string): repo.BankAccountRow
    ```

  - `createBankConnection` uses `got.accounts.map((a) => bankAccountRow(id, a, now))`.

### 2.3 Repository: `apps/worker/src/repositories/bank-connections.ts`

- `insertAccountIfStmt(db, row: BankAccountRow, guard: SQLWrapper)`: `insertSelect(db, bankAccounts, { ...every column of row by name }, sql\`where exists ${guard}\`).onConflictDoNothing()`. Copy `importsRepo.tombstoneIfStmt`. All 11 columns are named; null values are bound.
- `updateBalancesStmt(db, id, b, guard, names?: { name: string; mask: string | null })`: when `names` is given, the `set` also holds `name` and `mask`.
- `deleteUnlistedStmt(db, connectionId: string, bankAccountIds: string[], guard: SQLWrapper)`: `db.delete(bankAccounts).where(and(eq(bankAccounts.bankConnectionId, connectionId), inArray(bankAccounts.id, ids), sql\`not exists (select 1 from accounts a where a.bank_account_id = ${bankAccounts.id})\`, sql\`exists ${guard}\`))`. It is called only with a non-empty list.
- The doc comment of `checkedStmt` (line 166) becomes "the scheduled check".

### 2.4 The final batch: `services/plaid-sync.ts` `syncConnection`

After `const byPlaidId = …`, in this order, each statement with `guard`:

1. The status change_log row, if any (unchanged).
2. For each `b` of `bankAccounts` that is listed (`got`): `updateBalancesStmt(..., guard, changed ? { name: got.name, mask: got.mask ?? null } : undefined)`, where `changed` = `got.name !== b.name || (got.mask ?? null) !== b.mask`.
3. For each `a` of `balances` whose `account_id` is not among `bankAccounts`' `plaidAccountId`: `bankRepo.insertAccountIfStmt(db, bankAccountRow(row.id, a, finished), guard)`.
4. `markMissingStmt`, when `linkedRows.length > 0` (unchanged).
5. If `balances.length > 0`, take the ids of `bankAccounts` not listed. If there are any: `bankRepo.deleteUnlistedStmt(db, row.id, ids, guard)`.
6. `updateConnectionStmt`, **last** (unchanged): `final.length - 1` is still its index.

- Import `bankAccountRow` with `toApi` from `./bank-connections`.
- Add one comment line saying the list is sync state with no history row of its own.
- Nothing else in the run changes: no new read, no new Plaid call.

### 2.5 Calls: `apps/worker/test/sync-refresh-calls.test.ts` (acceptance 13)

- Copy the world of `link-status-calls.test.ts` test 1: two linked accounts and two new entries. Use `stubBank({ "/accounts/get": listed("acc-chk", "acc-sav", "acc-new") })`. Put `listed` in a small helper file `test/sync-refresh-helpers.ts` shared with 2.1.
- Expect `{ d1: 13, plaid: 2 }` and 3 rows.
- `link-status-calls.test.ts` stays as is, and must still give 13.

**Verify part 2:** run the new files plus `plaid-sync*.test.ts`, `link-status*.test.ts`, `bank-connections*.test.ts`, `account-links.test.ts`, `bank-link*.test.ts`, `connection-status*.test.ts` and `manage-connections-reads.test.ts`. Then `pnpm check`, then commit. Any existing expectation that changes is a departure: list it with its reason, for example a row now removed because it is unlisted and unlinked.

## Part 3: after Repair, Reauthorize and Reset; tools

- Acceptance 12 above is the server proof. The web needs no change: `useConnectionRelink` calls `invalidateBankLink` after its one sync (`apps/web/src/shell/manage-connections-relink.ts`). The browser half is spec case 17.
- `FIELDS` in `mcp/tools/bank-connections.ts`: append before the last sentence:
  > The accounts follow the bank's own list: each good sync adds an account the bank newly lists (unlinked), follows a changed name or mask, and drops an unlinked one the bank no longer lists; a linked one stays and reads Linked Account Not Found.
- `mcp-descriptions.test.ts` and `mcp-timestamps.test.ts` must pass unedited.

**Verify part 3:** `pnpm check`, then commit.

## Part 4: the screens

### 4.1 Stand-in: `e2e/support/bank-link-stub.ts`

- New option `bankAdds?: Record<string, FakeBankAccount[]>`. Its doc comment cites the Worker's final batch (`plaid-sync.ts` `syncConnection`) and `toApi` (`services/bank-connections.ts:42-52`).
- In `applySync`, inside the loop after the status check (connected only): `for (const add of opts.bankAdds?.[c.id] ?? []) if (!c.accounts.some((a) => a.id === add.id)) c.accounts.push(add);`.
- No other change.

### 4.2 Specs

Each test makes its own sandbox plan, through `setup`/`openDetail`/`dialogNamed` from `e2e/support/manage-connections-seed.ts` or the `missingState` pattern of `e2e/link-status.spec.ts` (copy what is needed into the spec file; do not edit those files).

- The new bank account: `fakeBankAccount({ name: "ZZ Rewards", mask: "4321", type: "credit", subtype: "credit card", plan_type: "creditCard" })`.
- Wait for the plan's sync: `await expect.poll(() => stub.requests.filter((r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(r.url)).length).toBe(1)`. The connection has `last_synced_at: null` and a linked account, so opening the plan sends it.
- Clicks use `realClick`; names use `{ exact: true }`.

**`e2e/sync-refresh.spec.ts`** (default 1440×900):

- `"15 a bank account the bank now lists shows in the connection's detail with the unlinked actions"`.
- `"16 Relink offers the bank account the bank now lists"`: choose it; one `POST …/link` with its id; the strip is gone.
- `"17 after Repair the new bank account shows in the open detail"`: `stubPlaidLink(page, OK)`, with the connection `login_required`; then `Repair`; one `/reset`, then one `/sync` (poll); `ZZ Rewards – 4321` is visible.

**`e2e/sync-refresh-narrow.spec.ts`**: `test.use({ viewport: { width: 1024, height: 700 } })`.

- `"18 at 1024×700 the new bank account's row and the Link Account choice lie in the window"`: cases 15 and 16. The `boundingBox()` of the row and of the choice are inside 1024×700, after `scrollIntoViewIfNeeded` when the list scrolls.

No time limit is raised for a file; any longer wait states why on its line.

**Verify part 4:** run `pnpm e2e e2e/sync-refresh.spec.ts e2e/sync-refresh-narrow.spec.ts`, plus `e2e/link-status.spec.ts e2e/manage-connections-reset.spec.ts e2e/manage-connections-accounts.spec.ts` (they use the stand-in). Then commit.

## Report checklist (Implementer)

- The failing lines quoted (1.1 every six hours; 2.1 added once).
- The D1 figures: 3 and 3 plus 5 runs; 13 and 13.
- The `wrangler.jsonc` diff, quoted whole.
- Departures, if any.
- That nothing was opened in the source app.
