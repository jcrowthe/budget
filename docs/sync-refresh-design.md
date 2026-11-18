# Sync refresh design (EXF-875 with EXF-751)

Two things the bank sync needs before the owner links real banks:

- **EXF-751:** the scheduled job runs every six hours (`0 3,9,15,21 * * *`), and each connection is really synced four times a day.
- **EXF-875:** a connection's bank accounts follow the bank's list. Each sync already reads that list from `/accounts/get`; from now on it adds any bank account the connection does not have yet.

The work is in the Worker. Manage Bank Connections and Link Account need no change: they already show any unlinked bank account. The Build starts from main `07e3715`. **No migration and no schema file.**

## The source app in this Build

**No step of this Build opens, reads or probes the source app.** The Clerk's tab command is the only contact, because the platform checks that the tab exists; nobody uses that tab. Reason: both tickets are about the Worker's sync and its schedule. The one screen touched (a new bank account in the Manage Bank Connections detail) uses the rows and buttons that exist, and the source's own screens for it are on the owner's real bank accounts, which nobody opens.

**Each step states in its report, for itself only, that it opened nothing in the source app, or what it did and why. Nobody but the Clerk runs the Clerk's commands.**

The Architect opened nothing in the source app. There are no study notes under `/workspace/scratch/source/`. The behaviour comes from the tickets, the Lead's brief and the clone's own code.

## What exists (read in the code)

- `apps/worker/wrangler.jsonc:24`: `"triggers": { "crons": ["0 3 * * *"] }`.
- `scheduled.ts` `cronRun`: first `enterDue` for `dayBefore(<UTC date>)`, then `syncDueConnections(env, now, run, { maxRuns: SCHEDULED_MAX_RUNS - SCHEDULER_CRON_CALLS })`.
- `syncDueConnections` (`plaid-sync.ts`) runs in two stages:
  - **Due syncs.** `listDue(db, now - DUE_AFTER_MS)`: connections with `last_synced_at` null or `<= now - 6 h`, not `login_required`/`broken`. They run round-robin, up to 5 runs each, each one Durable Object request (`requestSync`, its own invocation).
  - **Sign-in checks.** `listToCheck(db, now - CHECK_AFTER_MS (20 h), …)` with `{ check: true }`.
- **The trap.** A run writes `last_synced_at = new Date()` (`finished`) after the cron's `now`. Six hours later the connection is a few seconds short of 6 h, so every connection is synced only by every second run.
- `plaid-import.ts`: `DUE_AFTER_MS` (6 h) is also used by `isDue` and `bank-link.ts:116` (a plan's opening); those stay. Also `CHECK_AFTER_MS`, `SCHEDULED_MAX_RUNS = 40`, `SCHEDULED_WALL_MS = 10 min`, `RUN_CALL_BUDGET = 45`.
- `syncConnection`:
  - It reads `bankAccounts = accountsOf(db, row.id)` and calls `fetchBalances` (`/accounts/get`) on every good run (a check's list is reused).
  - Its final batch, guarded by `cursorIs(db, row.id, row.syncCursor)`, writes the balances of known rows, then `markMissingStmt` (when there are links), and ends with `updateConnectionStmt`, whose result is the conflict test.
  - **A listed account with no row is ignored.**
- `createBankConnection` (`services/bank-connections.ts`, around line 150) is the only insert into `bank_accounts`. Its mapping: name, `mask ?? null`, type, `subtype ?? null`, `plaidToMilliunits(current/available)`, `balanceUpdatedAt = last_updated_datetime ?? now`. Its local type is `PlaidAccount`.
- `BalanceAccount` (`plaid/transactions.ts`) types only `account_id` and `balances`, but `fetchBalances` returns Plaid's objects whole.
- `bank-accounts.ts`: `unique(bankConnectionId, plaidAccountId)`. `bank_connection_id` references `bank_connections`. Nothing references `bank_accounts`: `accounts.bank_account_id` has no foreign key (`20261116100600_account_links.sql`).
- Link writes are guarded by `exists (select 1 from bank_accounts where id = …)` (`repositories/accounts.ts:164, 430`).
- Web:
  - Repair, Reauthorize and Reset all use `useConnectionRelink` (`shell/manage-connections-relink.ts`): in the detail, `account/connection-status-strip.tsx` and `shell/connection-status-mark.tsx`.
  - After a good sign-in: `POST …/reset`, one `POST …/sync`, then `invalidateBankLink` (`api/bank-link.ts:87`). That refetches every query keyed by the plan id, including `["bank-connections", budgetId]`.
  - The detail lists accounts in server order (`createdAt`, then name).
  - Link Account lists every unlinked bank account (`account/link-account-dialog.tsx:78`).

## Approach

### EXF-751: the schedule

1. **The cron line.** `apps/worker/wrangler.jsonc` becomes `"triggers": { "crons": ["0 3,9,15,21 * * *"] },`. **That line is the only change in the file.**
2. **The schedule's own rule.** Add `SCHEDULE_DUE_AFTER_MS = 5 * 3600_000` to `packages/schema/src/plaid-import.ts`: "due for the scheduled run when last synced at or before five hours ago". `syncDueConnections` passes `now - SCHEDULE_DUE_AFTER_MS` to `listDue`.
   - `DUE_AFTER_MS` (six hours) stays for a plan's opening (`isDue`, `bank-link.ts`).
   - **Why five hours.** A run started at 03:00 finishes at 03:10 at the latest (`SCHEDULED_WALL_MS`), which is well before 04:00, the 09:00 run's line. A connection synced by the owner after 04:00 is skipped at 09:00 because its data is less than five hours old. A run a few minutes later finds nothing due.
   - **The figure:** each healthy connection is synced at 03, 09, 15 and 21 UTC, four times a day. A sync when a plan is opened, or Sync Now, may take the place of one run.
3. **Daily work run four times a day.**
   - **`enterDue`:** all four runs of a day share the day `dayBefore(UTC date)`, and an entered schedule moves past that day, so a later run finds nothing due. No test showed it on its own (the calls test runs `cronRun` twice but checks totals only), so acceptance 3 adds one.
   - **The sign-in check** stays once a day through `CHECK_AFTER_MS` (20 h): the runs 6, 12 and 18 h after a check pass the connection over, and the run at 24 h checks it. No code change; acceptance 4 pins it.
4. **Words.** Comments and tool texts that call the job daily or nightly as a fact follow:
   - `scheduled.ts:9` ("The daily job") becomes "The scheduled job (every six hours)".
   - `plaid-sync.ts:204`, `:226` and `:968`, `repositories/bank-connections.ts:166` and `plaid-import.ts:70`: "nightly check/run" becomes "the scheduled check (once a day)" or "a scheduled run".
   - The tools' `FIELDS` (`mcp/tools/bank-connections.ts:13`): "checked once a night" becomes "checked about once a day".
   - The `TODO: nightly backup` line is about a future Build and stays. Existing test titles stay.

### D1 and Plaid calls of one scheduled invocation (`cronRun`)

| Case | D1 in the cron invocation | DO requests | Plaid in the cron invocation | Per DO run |
|---|---|---|---|---|
| Nothing due, nothing to check | **3**: `enterDue`'s read, `listDue`, `listToCheck` | 0 | 0 | none |
| Five connections due (nothing to enter) | **3** | **5** | 0 | ≤ 45 calls (`RUN_CALL_BUDGET`); with two linked accounts and entries **13 D1 + 2 Plaid** (`link-status-calls.test.ts`) |

- The cron invocation's limit is 41 (37 runs plus the scheduler's ≤ 3 calls). Three D1 calls plus five DO requests (8 in all) stay well inside it and Cloudflare's 50. Each run is its own DO invocation with its own budget of 45.
- **Plaid endpoints a run calls:**
  - `/transactions/sync`: only when a link is open; 1 to `MAX_PAGES_PER_RUN` (4) pages;
  - `/accounts/get`: one per run. A check also makes one call, and the sync reuses that list.
  - Nothing else is called, and this Build adds no Plaid call. In particular it never calls `/accounts/balance/get`, which is billed per call.
- A test file pins both rows of the table (`sync-refresh-cron-calls.test.ts`).

### EXF-875: the bank's list in the final batch

1. **One mapping.**
   - `services/bank-connections.ts` exports `bankAccountRow(connectionId: string, a: PlaidAccount, now: string): BankAccountRow`. It holds the creation code's mapping word for word, with a fresh `crypto.randomUUID()` id and `createdAt: now`. `createBankConnection` uses it.
   - `PlaidAccount` moves to `plaid/transactions.ts` and is exported as Plaid's account in `/accounts/get`: `account_id`, `name`, `mask?`, `type`, `subtype?`, `balances`.
   - `BalanceAccount` becomes an alias of `PlaidAccount`, so `fetchBalances` is typed as what it already returns. That is a type-only change in `plaid/transactions.ts`.
2. **Added.**
   - In the final batch, from `balances`, the same list the run already holds, with **no further Plaid call**: each listed account whose `account_id` is not among `bankAccounts` gets `bankRepo.insertAccountIfStmt(db, bankAccountRow(row.id, a, finished), guard)`.
   - The insert is `insertSelect(..., sql\`where exists ${guard}\`).onConflictDoNothing()`, the same pattern as `tombstoneIfStmt`.
   - It is added whether or not the connection has links, and it is linked to nothing.
3. **Never twice.** The unique index on `(bank_connection_id, plaid_account_id)` and `ON CONFLICT DO NOTHING` cover a rerun and two runs at once.
   - A row that is already there changes nothing (0 rows) and does not fail the batch.
   - A connection removed meanwhile fails the guard, so nothing is inserted and the foreign key is never tried.
   - The Durable Object already serialises runs of one item.
4. **Name or mask changed.**
   - For a known row that is listed, the balance update also sets `name` and `mask`, only when one of them differs from the row as read (null-safe). `updateBalancesStmt` takes an optional `{ name, mask }`.
   - This adds no statement. Type and subtype are not followed.
5. **Unlisted and unlinked: removed.**
   - When the list is non-empty, one `bankRepo.deleteUnlistedStmt(db, row.id, ids, guard)` is pushed for the connection's rows absent from the list. It deletes only rows to which **no row of `accounts` (live or deleted, any plan) refers**.
   - **Why remove.** A "no longer listed" mark needs a column, so a migration, and this Build has none. A kept row would also stay on offer in Link Account. Nothing refers to the removed row; if the bank lists the account again, it comes back as a new row.
   - **Races.** A link write needs the row to exist, and the delete needs no link: whichever lands first wins, and no link points at nothing.
   - An empty list removes nothing (Plaid answers an item without accounts with an error, so an empty good answer is doubtful).
   - A **linked** unlisted row stays and reads `Linked Account Not Found`, as built (`markMissingStmt`, unchanged).
6. **Order in the batch.** The status change_log row (if any) comes first. Then the balance and name updates, then the inserts, then `markMissingStmt` (if links), then the delete (if any), and `updateConnectionStmt` **last**: its result is the conflict check, and it changes `sync_cursor`, which every guard rests on.
7. **History.** An added, renamed or removed bank account is **sync state, like the balances and `link_missing_since`**: no change_log row of its own.
   - A status change's `bank_connection` row (unchanged code) still carries the account list as read at the run's start, as it does for balances today.
   - Creation keeps its `create` row.
8. **D1 calls of one sync.** Before: **13 D1, 2 Plaid** with two linked accounts and two new entries (`link-status-calls.test.ts`). After: **13 D1, 2 Plaid**, also when the list holds a third account that gets added. Every new statement is in the final batch, so there is **no new round trip**.
9. **After Repair, Reauthorize and Reset.**
   - These flows send `POST …/reset` and then one `POST …/sync`. That sync adds the account, and `invalidateBankLink` then refetches `["bank-connections", budgetId]`. The flows themselves do not change.
   - Acceptance 12 proves the server half and acceptance 17 the web half.
10. **Screens.**
    - The new account is an ordinary unlinked row, listed last. It reads `<name> – <mask>` and opens `Link to an Existing Account` and `Add as a new Account`. **No word "new" is added, and no web file changes.**
11. **Tools.** `list_bank_connections`, `get_bank_connection` and `rename_bank_connection` return the rows, so the new accounts show.
    - `FIELDS` gains: "The accounts follow the bank's own list: each good sync adds an account the bank newly lists (unlinked), follows a changed name or mask, and drops an unlinked one the bank no longer lists; a linked one stays and reads Linked Account Not Found."
    - No new REST operation and no new tool.

### The browser stand-in

- `e2e/support/bank-link-stub.ts` gains the option `bankAdds?: Record<string, FakeBankAccount[]>`: connection id → bank accounts the bank lists beyond the connection's.
- In `applySync`, a sync of a **connected** connection appends each of its entries not yet among its accounts. That is what the Worker's final batch does. A connection that needs repair adds nothing, because the Worker returns early.
- Served by `connectionJson`, in the shape of `toApi` (`services/bank-connections.ts:42-52`):
  - `id`, `bank_connection_id`, `name`, `mask`, `type`, `subtype`, `current_balance`;
  - `available_balance` null, `balance_updated_at` null;
  - `linked_account_id: null`.
- The fields the screens show have real values: name `ZZ Rewards`, mask `4321`, `current_balance` 1250500.
- Nothing else changes in the stand-in.

## Downstream effects

- `link-status-not-found.test.ts` and other tests that list fewer accounts than the world: an unlinked row absent from the list is now removed. Tests that only read plan accounts are unaffected. Any test whose expectation must change is listed in the report as a departure, with its reason.
- `bank-link-calls.test.ts` (list 5, get 5) and `manage-connections-reads.test.ts` (4): the reads do not change.
- The sync when a plan opens keeps six hours.
- MCP descriptions change (`FIELDS`). `mcp-descriptions.test.ts` must still pass.

## Out of scope

- Pending transactions (EXF-466).
- The bank's own balance on the account's page.
- Any change to what Repair, Reset, Relink or Unlink do.
- Webhooks.
- Following type or subtype.
- A "no longer listed" state for a kept row.
- Every file of `paths.always_overlap` but the cron line, and the out-of-bounds files of the brief's note 3.

## Acceptance

### EXF-751

1. `git diff origin/main -- apps/worker/wrangler.jsonc` shows one changed line: `"triggers": { "crons": ["0 3,9,15,21 * * *"] },`.
2. **Every six hours** (`sync-refresh-schedule.test.ts`, fails on main first). `syncDueConnections` runs with a `run` stub that records the connection ids and writes `last_synced_at = <cron time> + 5 s`:
   - at 03:00:00 the connection runs;
   - at 09:00:00 it runs again (on main it does not: quote the line);
   - at 09:10:00 it does not run.
3. **Scheduler once per day** (same file). `cronRun` runs at 03, 09, 15 and 21 UTC of one day, with a daily and a monthly schedule due. Each is entered once (1 transaction each, `date_next` advanced once). A run at 03:00 the next day enters the daily one once more and leaves the monthly one alone.
4. **Sign-in check once a day** (same file). For a `login_required` connection and a refusing `/accounts/get`, five runs at t, t+6 h, t+12 h, t+18 h and t+24 h (t = real now; real `runSync`). `/accounts/get` is called at runs 1 and 5 only.
5. **Calls** (`sync-refresh-cron-calls.test.ts`). `cronRun` with nothing due: 3 D1, 0 runs. With five connections due and nothing to enter: 3 D1, 5 runs. 0 Plaid in the invocation in both cases.
6. `pnpm check` passes. The tool text no longer says "once a night".

### EXF-875

7. **Added once** (`sync-refresh-accounts.test.ts`, fails on main first). A world with ZZ Checking linked; `/accounts/get` lists acc-chk, acc-sav and `acc-new` ("ZZ Rewards", mask 4321, credit/credit card, current 50):
   - after one sync the connection has 3 rows, and `acc-new` has the mapped values (balance 50000 milliunits) and is linked to nothing;
   - after a second sync it still has 3 rows;
   - the same holds for a connection with **no** linked account.
   - On main the first expectation fails: quote it.
8. **Two runs at once.** The connection has no linked account, so its cursor does not move and both guards hold.
   - Two `runSync` calls started together (`Promise.allSettled`) both succeed and leave 3 rows.
   - Directly: one `db.batch` with `insertAccountIfStmt` twice for the same Plaid account gives changes `[1, 0]` and does not throw.
9. **Name and mask.** The list renames acc-sav and changes its mask. One sync changes the row's name and mask. A sync with the same list changes neither the row nor the change_log count.
10. **Unlisted.** The list drops acc-sav (unlinked): the row is gone after one sync. The list drops acc-chk (linked): the row stays and the plan account reads `link_missing_since` set. An empty good list removes nothing.
11. **Relink.** The bank lists acc-new instead of acc-chk. After one sync, the linked account is marked not found and acc-new is listed. `POST …/accounts/{id}/link {bank_account_id: <acc-new row>}` answers 200 with `link_missing_since: null`. The next sync marks nothing, and the old acc-chk row, now unlinked and unlisted, is removed.
12. **After Reset/Repair/Reauthorize, server.** A `login_required` connection (reason reauthorize) with acc-new listed: `POST …/reset`, then `POST …/sync`, then `GET /api/v1/bank-connections?budget_id=` shows acc-new unlinked. The tool `list_bank_connections` shows it too.
13. **Calls** (`sync-refresh-calls.test.ts`). The world of `link-status-calls.test.ts` (two linked accounts, two new entries) with acc-new listed: one sync is **13 D1, 2 Plaid**, the same as before.
14. **History.** The added row writes no change_log row: the `bank_connection` change_log count is unchanged by a sync of a connected connection that adds an account.

### Screens (`e2e/sync-refresh.spec.ts` at 1440×900, `e2e/sync-refresh-narrow.spec.ts` at 1024×700)

Each spec makes its own sandbox plan through the API, uses the stand-in with `bankAdds`, and clicks with `realClick`.

15. **Detail.** The connection `ZZ Bank` is connected with `last_synced_at: null`. It has ZZ Checking (0000, linked) and ZZ Savings (1111), and `bankAdds` holds ZZ Rewards (4321).
    - Open the plan, then `expect.poll` for one `POST /budgets/{id}/sync`. Open Manage Bank Connections, then `ZZ Bank`.
    - The button `ZZ Rewards – 4321` is the last row, without a "Linked to" line.
    - Clicking it shows `Link to an Existing Account` and `Add as a new Account`.
16. **Relink.** As in `link-status.spec.ts` `missingState`, ZZ Linked is linked to ZZ Checking and marked missing, and `bankAdds` holds ZZ Rewards.
    - After the plan's sync, `Relink` on the strip opens `Link Account`, which lists `ZZ Rewards – 4321`.
    - Choosing it sends one `POST …/link` with that `bank_account_id`, and the strip is gone.
17. **Repair** (wide spec only). `ZZ Bank` is `login_required`, and `bankAdds` holds ZZ Rewards.
    - In the detail, `Repair` with `stubPlaidLink` success sends one `POST …/reset`, then one `POST …/sync`.
    - `ZZ Rewards – 4321` then shows in the open detail without reopening the dialog.
18. **Narrow.** At 1024×700, cases 15 and 16 hold, and the row and the dialog's list lie inside the window (bounding box within the viewport).

### Looking

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state (with the browser stand-in in the server's shape), takes a **fresh** screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it. The report lists `state, size, file, sentence`. **Two states, four screenshots, every one opened; take no others unless something looks wrong.**

1. Manage Bank Connections' detail of a connection whose bank now lists one account more than when it was connected: the new bank account's row, not linked, with the actions an unlinked bank account has.
2. The Link Account dialog of a plan account (opened from `Relink` on an account that reads `Linked Account Not Found`): the new bank account among the choices.

### What a Deploy can check

- **EXF-751.**
  - The release phase's `deploy` step runs `wrangler deploy` (`scripts/deploy.sh:174`). Its output, after "Deployed budget triggers", prints `schedule: 0 3,9,15,21 * * *`; quote that line.
  - A read-only check: `GET /client/v4/accounts/<account>/workers/scripts/budget/schedules` returns `cron: "0 3,9,15,21 * * *"`.
  - Later, a Sandbox test connection's `last_synced_at` (`list_bank_connections`) moves forward about every six hours.
- **EXF-875.**
  - A new bank account cannot be produced on live with certainty.
  - Plaid's Sandbox bank lets a sign-in choose accounts. A live test can connect with one account ticked, run Repair with two ticked, then read `list_bank_connections`: two rows, the new one unlinked, no duplicates after a second Sync.
  - Without that flow, the Deploy can only check that a Sync leaves the list unchanged and free of duplicates.

## The order of the work

Copied from the brief. The Implementer commits after each part.

1. EXF-751: the failing tests (the second run six hours later; the scheduler twice a day; the sign-in check once a day), the schedule's own rule, the cron line.
2. EXF-875 in the Worker: the failing test, the mapping in one function, the last batch, a changed name, the calls counted.
3. After Repair, Reauthorize and Reset; the tools' description.
4. The screens: the stand-in, the two specs, the narrow window.

## Manifest

touches: [apps/worker/wrangler.jsonc, apps/worker/src/scheduled.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/plaid/transactions.ts, apps/worker/src/mcp/tools/bank-connections.ts, packages/schema/src/plaid-import.ts, apps/worker/test/sync-refresh*.ts, e2e/support/bank-link-stub.ts, e2e/sync-refresh*.spec.ts, docs/sync-refresh-*.md, docs/README.md]
shared: []
migrations: 0
