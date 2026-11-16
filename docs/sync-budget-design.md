# Sync budget design (EXF-613)

One run of the bank sync (`runSync`, merged in `9e77748`) stays inside a fixed budget of calls, and a run
that fails leaves a status and a time on the connection. **Worker only. No screen changes**: nothing under
`apps/web/` changes. Spec: [sync-budget-spec.md](sync-budget-spec.md). Base design:
[plaid-import-design.md](plaid-import-design.md). "Note *n*" means the Lead's scope notes in this Build's brief.

## Source

**Not compared: the Lead forbade it, and no screen changed.** No study notes and no screenshots. The behaviour
comes from the ticket, the Lead's notes and the code at `9e77748`. This step did not open the source app, did
not call Plaid and did not call the live app.

## Facts: Cloudflare's published limits (note 1)

I read these from the pages on 2026-11-16.

| Limit | Free | Paid | Source |
|---|---|---|---|
| D1 queries per Worker invocation | **50** | 1,000 | D1 limits page, "Queries per Worker invocation", last updated Oct 30, 2026 (developers.cloudflare.com/d1/platform/limits/) |
| `db.batch()` against that limit | **one query**, whatever its statement count | same | same page, batch note: "a db.batch() call counts as a single query against it, not one query per statement" |
| Bound parameters per statement | 100 | 100 | same page |
| Subrequests per invocation | **50** | 10,000 (up to 10M) | Workers limits page, Nov 13, 2026: "any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1". The 2026-02-11 changelog splits Free into "50 external subrequests" and 1,000 to Cloudflare services |
| CPU, HTTP request / Worker | 10 ms | 30 s default (up to 5 min) | Workers limits page |
| CPU, Cron Trigger | 10 ms | 30 s (interval < 1 h), 15 min (≥ 1 h) | Workers limits page. Our cron `0 3 * * *` is daily |
| CPU, Durable Object request (SQLite-backed, our class) | 30 s | 30 s (up to 5 min) | DO limits page, Nov 13, 2026: "Each incoming HTTP request or WebSocket message resets the remaining available CPU time to 30 seconds" |
| Wall time | HTTP and DO `fetch`: no hard limit while the caller stays connected. Cron: 15 min. DO alarm: 15 min | same | Workers and DO limits pages |

**I could not find this one:** no page says that each request to a Durable Object gets its own allowance of
queries and subrequests. Here is what supports it:
- The DO page measures CPU per incoming request.
- Its FAQ says DOs "have the same per invocation CPU limits as any Workers do".
- D1 states its limit per invocation.

**Assumed:**
- A request to `PlaidItemSync.fetch` is its own invocation for queries and subrequests.
- The app runs on the **Free plan** (note 1). D1 queries and Plaid calls count against **one combined
  allowance of 50**, because the Workers page counts D1 calls as subrequests. That is the strictest way to
  read the pages.

The scheduled handler is built so that its own invocation stays inside the limits whichever way this turns
out. If the assumption about Durable Objects were wrong, the fix would be to continue the runs in DO alarms,
which is out of scope. The ticket's live flow test after the next release is the evidence for that.

## The budget

- **`RUN_CALL_BUDGET = 45`**: the planned ceiling for one run. It counts every D1 call (a statement run on its
  own, or one `db.batch`) plus every Plaid call, the final batch included.
- **`+1`**: the failure write (below). It comes only after the run has failed.
- **`RUN_CALL_HARD_LIMIT = 48`**: a safety stop in the counter. A call that would go past it throws
  `CallLimitReached`, which makes the run a failed run. The failure write may still use one more call.

So one invocation makes at most 49 calls, under the 50 that either reading of the Free limits allows.

### Today versus after, for 500 new entries

The case: payee history for every payee, ten matches, one plan, one account. The numbers come from the code;
the Implementer reports the measured counts.

| | D1 calls | Plaid calls | Runs |
|---|---|---|---|
| `9e77748` | about **1,070** in one run. The biggest item is `namesOf` (2 reads × 500); then tombstones 6 + rows 6, matches 2 × 10, and about 29 write batches. That is over the Paid limit too | 2 | 1, failing at the limit |
| After | **≤ 45 per run**, final batch included (about 44 in run 1, about 20 in run 2) | 2 per run | about 2 runs |

## Approach

### 1. Count (note 2)

`runSync` creates a `CallBudget` and passes everything below it two wrapped handles:
- an env whose `DB` counts each executed statement and each `batch` as one call;
- a Plaid client whose `post` counts one call.

The wrapping lives in a new file, `services/sync-budget.ts`. `db/client.ts`, `secrets/**` and
`plaid/client.ts` do not change. The token and credential reads go through the counted `env`, so they are
counted too.

### 2. Fewer reads (note 4)

What one run reads:

| Read | Where | Calls |
|---|---|---|
| connection, its bank accounts, token, Plaid credentials, linked accounts | as today | 5 |
| live plans of the linked accounts | **one** `livePlanIds` query, which replaces `findActive` per plan (a deleted test plan still linked cost one read each) | 1 |
| Plaid pages + `/accounts/get` | as today | ≥ 2 |
| payees of each plan with entries | `listForPlan`, as today | 1 per plan |
| **context batch**: for every open account with entries, its Starting Balance date, latest reconciled date, match candidates and (in recovery) live dates and amounts; for every plan, the **category and group names** of all its categories | **one `db.batch`** of the same SQL as today | 1 |
| per unit: tombstones + live rows for ≤ 90 ids | one `db.batch` of the two selects | 1 |
| per unit: lines of the parents the unit changes (picked candidates, followed rows) | one `listLines({ parentIds })` | 0–1 |
| per removed row to delete | `findDetail` + `listLines`, as today (rare) | 2 |

**Names.** One map per plan and run: category id → `{ name, groupName, deleted }`.
- New imports: names when the category is active, nulls when it is deleted. This is what `namesOf` returns.
- Matches and followed rows: names whether deleted or not, which is what `findDetail`'s left joins return.

`namesOf` and `findDetail` are no longer called per entry.

The SQL and meaning of every read stay as they are. Two things change: reads are grouped into a batch, and a
candidate read is never narrower than its account's own date window.

### 3. Progress inside a page (note 3): the position is the data already written

Choice: **keep `count: 500`, and keep the position inside the page implicit.** When the budget stops a run:
- `sync_cursor`, `sync_loop_cursor`, `sync_accounts` and `sync_error_since` stay exactly as they were;
- the next run reads the same entries again from the same cursor;
- every entry already written is now *known* and writes nothing: its import id is on a live row, or it has a
  tombstone, or `followBank` finds nothing different. This is the existing "a repeat changes nothing" rule,
  which tests 462-3 and 462-11 prove.

So an entry is never skipped: the cursor never passes an entry that was not written, and Plaid returns every
update after a cursor. An entry is never written twice: the guards and the unique index hold.

**Why not the other two:**
- A **stored offset** inside a page assumes Plaid returns the same page, in the same order, for the same
  cursor on a later day. Plaid does not promise that, and the run's net changes merge up to 4 pages.
- **Smaller pages** cannot guarantee that "a whole page always fits". A page's cost grows with the number of
  plans an entry lands in, and with the mix of writes: a match takes up to 8 statements, a skip none. Smaller
  pages would also spend more Plaid calls.

The cost is that the next run reads the written entries again: one call per 90 entries, with no writes.

**Plaid's restart rule (AC 6)** keeps working unchanged. A stopped run saves no cursor, so the next run starts
where the stopped run started, with the stored loop cursor. A `MUTATION_DURING_PAGINATION` restarts from
`sync_loop_cursor ?? run start`, as today.

**Same decisions as one long run.**
- Entries are processed in the same order: open accounts, then entries sorted by date and id.
- The next run sees the earlier entries' matched candidates as already imported (`import_id` set). That is
  exactly the in-run `used` set.
- Its recovery check still leaves out this run's own ids.
- `sync_error_since` is kept, so the recovery rule still applies to the rest of the page.
- `skipped` counts the rule-skipped entries of the run's pages, so after a stop the next run counts them
  again (reporting only, nothing is written).

### 4. Units and the budget check

The run works through **units**. A unit is up to 90 entries of one plan account, in the order above. Removed
ids are processed after all upserts, per plan, in slices of up to 90. For each unit:
1. **Before its reads**, the run needs room for its read batch, a lines read, one write batch and the final
   batch. Without that room the run stops.
2. It reads, decides and builds the groups exactly as today (`followBank`, `skipReason`, `pickMatch`,
   recovery duplicate, insert).
3. It writes the **longest prefix of those groups** whose batches still leave room for the final batch.
   `batchCount` gives the same packing as `runGroups`, and a group is never split. If the prefix is shorter
   than the unit, the run stops.

A run that stopped early reports `has_more: true`.

A run that stops **without having written anything** throws `SyncBudgetTooSmall`, and it becomes a failed
run, which is visible. The next run would stop at the same place. That needs four or more plans linked to one
bank account with a backlog near 1,000 entries, because reading the written entries again costs one call per
90 entries per plan.

**Final batch.**
- Complete run: as today, plus `sync_failed_at = null`.
- Stopped run: `last_synced_at`, `status connected`, `sync_failed_at null`, `updated_at` and the balances,
  all guarded on the old cursor as today. It does **not** write the cursor, loop cursor, link set or
  `sync_error_since`.

"Writes first, cursor last" holds.

### 5. Failed runs (note 6)

A new nullable column **`bank_connections.sync_failed_at`**, added by migration
**`20261116100900_sync_failed_at.sql`** (one additive `ALTER TABLE`).

Once the connection row is read, any error that is not the bank's answer is caught by `runSync`. That covers
a thrown D1 error, `sync conflict`, `CallLimitReached`, `SyncBudgetTooSmall` and a secrets error.
`PlaidApiError` is still a status, and `PlaidNotSetUp` is still returned. `runSync` then:
- writes **one batch**: `status = 'delayed'`, `sync_failed_at = now`, `updated_at = now`, and one
  `bank_connection` change_log row (`service:plaid`, `toApi` before and after). Its guard is that the
  connection exists and its status is not `login_required` or `broken`, so a needed repair is never hidden;
- writes no cursor and keeps the old one;
- swallows an error from that write;
- rethrows the original error. The Durable Object still logs only the id and answers 500.

The run that finishes next sets `connected` and `sync_failed_at = null`.

**Why `delayed`, and why not `sync_error_since`.** `delayed` already means "temporary; the sync is retried; no
repair needed", and that is still true. Its description now adds the cause. `sync_error_since` stays untouched
because it switches on the "came back" `recovery_duplicate` rule, which is meant for bank outages. Setting it
after our own failure would change which entries are skipped (note 7).

**Showing the failure.** `GET /bank-connections`, `GET /bank-connections/{id}`, `list_bank_connections`,
`get_bank_connection` and `rename_bank_connection` return `sync_failed_at`. In the schema it is
`.nullable().default(null)`, so stubbed web answers still parse.

**Why the guard does not ask for the old cursor.** Only `runSync` writes `sync_cursor`. A `sync conflict`
therefore means another run moved it, or the row is gone. A guard on the old cursor would hide exactly the
case the Lead wants to see.

### 6. The scheduled handler (note 5)

Each `requestSync` is a separate request to the connection's Durable Object, so each run is its own DO
invocation (see Facts for the assumption). `syncDueConnections` now runs connections **round-robin**:
- round 1 runs each due connection once;
- each later round runs again only the connections that answered `has_more`;
- at most `MAX_RUNS_PER_CONNECTION` (5) runs per connection;
- at most **`SCHEDULED_MAX_RUNS = 40`** runs in one scheduled invocation;
- no new run starts after `SCHEDULED_WALL_MS = 10 min`, which stays under the 15-minute cron wall time.

The scheduled invocation itself makes one D1 call (`listDue`) and at most 40 DO subrequests, so 41 calls. That
fits 50 under every reading. A connection's error is still caught and logged by id, and its later rounds are
skipped. `scheduled.ts` and `durable/plaid-item-sync.ts` do not change.

## What does not change (note 7)

- Which entries are imported, matched, skipped or tombstoned.
- The guards and the unique index.
- "A repeat changes nothing".
- The two Plaid calls, `count: 500`, `MAX_PAGES_PER_RUN` and `MAX_UPDATES_PER_RUN`.
- The 90-statement batches. `runGroups` itself does not change.
- `countsInBalance` and every query that sums or counts `transactions`. The Starting Balance and reconciled
  reads become query builders with the same SQL.
- The token's path. Neither the counter nor the failure write logs, returns or stores a secret.

## Downstream effects

- The BankConnection API and its change_log copies gain `sync_failed_at`.
- The `delayed` description changes in the schema and in `sync_bank_connections`. `has_more` now also means
  "the run stopped at its budget".
- Tests that fix how many runs a large import takes may change: 462-15 and the two 462-24 cases; 462-11 fixes the ordinal of a failing batch and changes with it. Every other
  existing test passes unchanged.
- After the migration, delete `.e2e-state`.

## Out of scope

- Any screen, including the status display (EXF-465).
- Continuing runs in DO alarms.
- Raising the 90-statement batch size.
- Changing `count`.
- A stored offset inside a page.
- Paid-plan tuning.
- Reports, Plan-page files, `packages/core/**`, `apps/web/**`, e2e specs, and the shared and always-overlap
  files.

## Acceptance

All of these are Worker tests against the Plaid stand-in, with `SENTINEL` credentials. None calls Plaid, the
live app or the source.

Setup: `world1()` (Sandbox plan, connection, linked checking, `today` 2026-03-10).

**Counting env:** a test-owned proxy over `env.DB`.
- It counts each `all/raw/first/run` of a prepared statement and each `batch`/`exec` as one.
- Plaid calls per run are the stand-in's call log difference.
- The ceiling is the literal **45**.

1. **Budget import (AC 1).** Setup:
   - 500 `added` entries on one page, each with its own payee name.
   - For every payee, an older hand row (SQL insert dated 2026-01-05) with a category, so every import takes a
     category.
   - Ten hand rows with the date and amount of ten of the entries.

   Run `runSync` until `has_more` is false (at most 6 runs). Expected:
   - at least 2 runs;
   - the sum of `added` is 490 and the sum of `matched` is 10;
   - 500 live rows carry the 500 import ids, each once;
   - 490 `create` and 10 `update` transaction change_log rows by `service:plaid`;
   - every import that is not a match has its payee's category;
   - after the last run, `sync_cursor` is `c1`.
2. **Counting (AC 2).** Case 1 under the counting env: every run's D1 + Plaid calls ≤ 45. **Run this test file
   on the `src` of `9e77748` (it fails there: run 1 makes ~1,000 calls) and on the new code (it passes). The
   report gives both counts.**
3. **Stopped run (AC 3).**
   - Case 1 with `callBudget: 25` passed to `runSync`. Run 1 has `has_more: true` and `added` > 0.
     `sync_cursor`, `sync_loop_cursor`, `sync_accounts` and `sync_error_since` equal their values before the
     run. `last_synced_at` moved and the status is `connected`.
   - The next runs finish. Every id appears once and there is no second live copy.
   - Re-running from a null cursor adds 0 rows and 0 change_log rows.
   - Variant: the 3rd batch of run 1 throws once. The run rejects; then the runs finish with every id once.
4. **Thrown error (AC 4).**
   - `failingBatchEnv(2)` over 40 entries. The run rejects with "simulated".
     `GET /bank-connections/{id}?budget_id=`, `GET /bank-connections?budget_id=` and MCP
     `list_bank_connections` all show `status: "delayed"` and an ISO `sync_failed_at`. `sync_cursor` is still
     null and `sync_error_since` is still null. There is one new `bank_connection` change_log row.
   - The next run gives `connected` and `sync_failed_at: null`.
   - **Conflict variant:** a DB proxy sets `sync_cursor = 'cX'` just before the last batch. The run rejects
     with "sync conflict". The connection shows `delayed` with `sync_failed_at`, and `sync_cursor` is `'cX'`.
   - A `login_required` connection whose run throws keeps `login_required`.
5. **Unchanged (AC 5, note 7).**
   - Every existing test in `plaid-sync.test.ts`, `plaid-sync-runs.test.ts`, `transactions-approve.test.ts`,
     `bank-connections*.test.ts` and `mcp-*.test.ts` passes unchanged. The exceptions are 462-15, 462-24 and 462-11 (the failing batch's ordinal moves from 2 to 4, because batches 1 and 2 are reads),
     and only where they fix runs or rows per run.
   - `git diff 9e77748 -- apps/worker/src` shows no change to `countsInBalance`, `balancesByAccount`,
     `activityByMonth` or the reports.
6. **Restart after a stop (AC 6).**
   - Feed: four pages of 100, then a fifth page of 900.
   - Run 1 completes 400 entries: `sync_cursor` `c4`, `sync_loop_cursor` `''`.
   - Run 2 (from `c4`) is stopped by the budget: `c4` and `''` are kept.
   - Run 3: the stand-in answers `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` to `c4` once. The next
     `/transactions/sync` call carries **no cursor**, which is the loop's start.
   - Further runs finish all 1,300 entries, each once.
7. **Schedule (AC 7).**
   - Three due connections in three plans, each fed one page of 900 entries.
   - Afterwards each of the three has imported rows (more than 0) and has been run at least twice.
   - `/accounts/get` calls, one per run, number at most 15 and at most 40.
   - Every connection that finished has `has_more` false.
   - A unit test of the round-robin with a stubbed `requestSync` never asks for more than 40 runs, never
     more than 5 per connection, and asks each due connection in round 1.
8. **Descriptions.** `list_bank_connections`, `get_bank_connection` and `rename_bank_connection` name
   `sync_failed_at` among the nullable timestamps. `mcp-timestamps.test.ts` and `mcp-descriptions.test.ts`
   pass.
9. **No secret.** Cases 3 and 4 assert `clean()` on the responses, on the `change_log` text and on `console.*`
   arguments.

## Manifest

touches: [apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/sync-budget.ts, apps/worker/src/services/batch-groups.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/db/schema/bank-connections.ts, apps/worker/migrations/20261116100900_sync_failed_at.sql, apps/worker/src/mcp/tools/bank-connections.ts, packages/schema/src/plaid-import.ts, packages/schema/src/bank-connections.ts, apps/worker/test/plaid-sync*.ts, apps/worker/test/plaid-stub.ts, docs/sync-budget-design.md, docs/sync-budget-spec.md, docs/plaid-import-design.md, docs/plaid-import-spec.md, docs/README.md]
shared: []
migrations: 1

Files outside the Lead's expected list, and why:
- `services/sync-budget.ts`: new; the counting wrapper, so `db/client.ts` stays as it is.
- `repositories/accounts.ts`: query-builder exports of `startingBalanceDate` and `latestReconciledDate`, with
  the same SQL, so they can go into the context batch.
- `repositories/transactions.ts`: an additive `parentIds` filter on `listLines`.
- `db/schema/bank-connections.ts`: the migration's schema file.

Not touched: `plaid/transactions.ts`, `durable/plaid-item-sync.ts`, `scheduled.ts` (none needs a change).
