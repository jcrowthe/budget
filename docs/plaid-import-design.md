# Plaid import design (EXF-462, Worker half of EXF-463)

Imports posted bank transactions from Plaid into linked plan accounts as **imported, unapproved** rows,
on a schedule and on request, with automatic matching and no double import; approve and reject them over
REST and MCP. **No screen changes**: nothing under `apps/web/` changes. Spec:
[plaid-import-spec.md](plaid-import-spec.md).

## Source

**Not compared: forbidden by the Lead; no screen changed.** A linked account in the source shows the owner's
real bank data, so nobody opens, reads or captures the source app in this Build. The behaviour comes from the
two tickets (help-page rules) and the Lead's scope notes 1 to 15, which override the tickets. There are no
study notes and no screenshots. The proof against Plaid's real Sandbox is a later flow test on the live app.

## What exists (read in the code)

`plaidFor().post()`, `PlaidApiError(status, errorCode)`, `getAccessToken`, `plaidToMilliunits`;
`bank_connections` (`status`, `last_synced_at`, unused `sync_cursor`); `bank_accounts` balances in Plaid's
sign. A connection belongs to an environment, not a plan: a bank account may be linked in **several plans**.
Closing an account unlinks it. `insertIfStmt` lists columns **positionally** (Drizzle order); `mutate()` does
every PATCH/DELETE under `holdsAt` guards. `PlaidItemSync` and `scheduled()` are stubs (cron daily 03:00).

## Approach

```
route / MCP / scheduled ──► requestSync(env, conn) ──► DO PlaidItemSync (one per Item, idFromName(plaid_item_id))
                                                         └─ coalesces: running ? await running : runSync(env, id)
runSync: read state ─► Plaid /transactions/sync pages ─► Plaid /accounts/get ─► pure decisions
         ─► write chunks (guarded, idempotent) ─► final batch: cursor + balances + last_synced_at + status
```

Decisions of notes 3–6 are pure functions in `packages/schema/src/plaid-import.ts` (unit-tested, no
database); `services/plaid-sync.ts` reads, calls Plaid and writes.

### One run (`runSync(env, connectionId, opts)`)

1. **State.** The connection row; if its status is `login_required` or `broken`, return that status at once
   (no Plaid call, nothing written). The token (`getAccessToken`); missing → status `broken`. The
   credentials (`plaidFor(env, row.environment)`); `PlaidNotSetUp` → status `not_set_up` (reported, not stored).
2. **Links.** Every non-deleted account of a non-deleted plan linked to one of the connection's bank accounts
   (`linkedToConnection`). The link set `sync_accounts` = sorted `account_id:import_start_date` of the open
   ones. If the stored `sync_accounts` lacks one of them (a new link since the cursor was taken), the run
   starts from a **null cursor** (a full re-sync is always safe: see "never twice"); otherwise from
   `sync_cursor`.
3. **Fetch.** `/transactions/sync` (`count: 500`, `options.include_original_description: true`, `cursor` only
   when not null) page after page until `has_more` is false or the run holds `MAX_UPDATES_PER_RUN` (500)
   updates; then `has_more` of the run is Plaid's. `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` drops the
   pages and restarts from the run's start cursor (at most 3 restarts, then status `delayed`). Then
   `/accounts/get` for balances. **Any Plaid error before the writes: nothing is written** except the
   connection's status (and `sync_error_since` when null) in one batch with its change_log row; the cursor
   and `last_synced_at` stay.
4. **Net changes** (pure `netChanges`): later pages win; an id in `removed` drops its earlier `added` /
   `modified`; pending entries are dropped (EXF-466). A `modified` id that is not known is treated as `added`
   (the rules still apply, so a skipped one stays skipped).
5. **Decide** per linked account (reads chunked at 90 ids per `IN`, D1's 100-parameter limit): known
   import ids, tombstones, the Starting Balance date, the latest reconciled date, the match candidates, the
   plan's payees with `last_category_id`.
6. **Write** in chunks (`SYNC_STATEMENTS_PER_BATCH` = 90). One import's statements never straddle a chunk.
   Then the **final batch**: `sync_cursor` = the last page's `next_cursor`, `sync_accounts`,
   `last_synced_at`, `status = connected`, `sync_error_since = null`, the bank accounts' balances, and one
   `bank_connection` change_log row; guarded on `sync_cursor` still being the value read at step 1.

### Never twice (notes 2, 3)

- **Known import id** = a **live** row of the same plan with that `import_id`, or a tombstone of the plan
  with it. Plaid's `transaction_id` is unique, so the plan-wide check also covers a row the user moved to
  another account. Unique index `transactions_budget_import (budget_id, import_id) WHERE import_id IS NOT NULL
  AND deleted_at IS NULL`: a second live insert is impossible in any account.
- **Tombstone** `import_tombstones (account_id, import_id)` primary key, plus `budget_id`, `reason`
  (`rejected` | `deleted`), `transaction_id`, `created_at`. Written by reject and by **every user deletion
  of a row that carries an `import_id`** (DELETE, and the other side of a deleted transfer), in the same batch.
  So a deleted row without a tombstone is only ever a **bank removal** (note 6, no tombstone, "may come
  back"), which is why the index and the check look at live rows only.
- **Ordering**: the cursor is written last. A crash after chunk *k* repeats the run from the old cursor and
  every statement is then a no-op (inserts guarded by "not known", matches by `holdsAt`, modified/removed
  re-decided from fresh reads, payees inserted only if missing and referenced by name): **a repeat changes
  nothing**, change_log included.

### Never import (note 3), pure `skipReason`

| reason | rule |
|---|---|
| `pending` | `pending: true` (dropped by `netChanges`, not counted in `skipped`) |
| `account_closed` | the plan account is closed (the write is also guarded: account live, open, still linked to that bank account) |
| `before_start` | `date < import_start_date` or `date <` the live Starting Balance row's date |
| `before_reconciled` | `date < latest reconciled date − 3 days` (`latestReconciledDate`) |
| `known` | known import id (above) |
| `recovery_duplicate` | the run "came back" and no match was found, and a live row of the account has the same date and amount |

**"Came back"** (EXF-465 not built): `bank_connections.sync_error_since` is set by the first failed run and
cleared by the next successful run. A run that **starts** with it set applies `recovery_duplicate`. A repair
(`finishReset` sets `connected`) leaves it set, so the first sync after a repair also applies it.

### Writing an import (notes 1, 4)

`amount = 0 − plaidToMilliunits(t.amount)`; `date = t.date`; `cleared`; `approved false`; `source 'plaid'`;
`import_id = transaction_id`; `imported_payee = t.name`; `bank_description = original_description ?? name`;
`import_date/import_amount/import_payee_name` = the same date, amount and payee name (kept for EXF-464).
**Payee**: `(merchant_name || name)` trimmed, at most 200 chars; empty → no payee. Found by exact name among
the plan's live **ordinary** payees (never a system or transfer payee), else created (one create per name per
run). **Category** (pure `categoryFor`): accounts that take no category (tracking, loan) → none; else the
payee's `last_category_id` when it has one; else an inflow (`amount > 0`) into checking or savings → Ready to
Assign; else none. Renaming rules (EXF-467) and the 2-of-3 rule (EXF-515) are not built.

A bank account linked in two plans gets one import in each. **Two imports that are the two sides of one
transfer stay two plain rows**; they are not joined (later work).

### Automatic matching (note 5), pure `pickMatch`

Candidates: live rows of the same account, not split lines, `import_id IS NULL AND source IS NULL`
(hand-entered, never matched), same `amount`, `|date − import date| ≤ 10` days. Closest date wins, then the
oldest `created_at`, then id. One candidate per import; a candidate used in the run is not used again. A
split parent is a candidate by its total; a transfer row of this account can be, a row of another account
never. The matched row keeps payee, memo, date and category; it takes `import_id`, `imported_payee`,
`bank_description`, `import_date/amount/payee_name`, `cleared = cleared` (stays `reconciled` when
reconciled) and `approved = true`; a split parent's lines follow (`syncLinesIfStmt`). It stays
`source = NULL`. **`matched` = `import_id IS NOT NULL AND source IS NULL`.** The match update is guarded by
the candidate's `holdsAt`; right after it comes the import's own insert, guarded by "not known": if the user
changed the candidate meanwhile, the import is inserted instead, so nothing is lost.

### Modified and removed (note 6), pure `modifiedPlan`

- **Unapproved and unmatched** (`approved = 0 AND source = 'plaid'`): `modified` follows the bank (date,
  amount, payee as for an insert, `imported_payee`, `bank_description`, `import_*`); `removed` soft-deletes
  it, **no tombstone**.
- **Anything else** (approved or matched): `modified` updates only `bank_description` (and the internal
  `import_*` copies, not in the API); `removed` does nothing.
- An update whose values are already there writes nothing. Each statement is guarded on the row's
  `updated_at` as read: a user edit during the run wins.

### Concurrency (note 7)

`PlaidItemSync.fetch` keeps `running: Promise<SyncResult> | null` in memory: a request while a run is in
progress awaits the same promise and gets the same result. The object stores **nothing** (no storage, no
secret; the token is read per run). `requestSync` calls `env.PLAID_ITEM_SYNC.get(idFromName(plaid_item_id))`
with `POST https://plaid-item-sync/run {connection_id}`; a non-200 answer throws (route 500).

### When it runs (note 8)

- `POST /bank-connections/{id}/sync?budget_id=` (the plan decides the environment, like the other `{id}`
  routes) → one run.
- `POST /budgets/{budget_id}/sync` → every connection of the plan's environment with a bank account linked
  to a live account of that plan, one after the other.
- `scheduled()` → `syncDueConnections(env, now)`: every connection (both environments) whose
  `last_synced_at` is null or older than 6 hours **and** whose status is not `login_required` / `broken`;
  per connection up to `MAX_RUNS_PER_CONNECTION` (5) runs while `has_more`; an error on one connection is
  caught and the next goes on. Right at any cron frequency; `wrangler.jsonc` is not touched.

### Statuses

`connected` · `delayed` (temporary: network, 5xx, rate limit, institution down, mutation restarts used up,
any unknown code) · `login_required` (needs repair: `ITEM_LOGIN_REQUIRED` and the other credential and
consent codes listed in the spec) · `broken` (no token, `ITEM_NOT_FOUND`, `INVALID_ACCESS_TOKEN`) ·
`not_set_up` (no credentials; returned, never stored). A status change is one `bank_connection` change_log row.

### History and secrets (note 10)

Every insert, match, update and delete of a sync, every payee it creates, and the connection update have a
change_log row with actor **`service:plaid`** (the conventions name `service:<token name>`; one line is added
to say `service:plaid` is the sync's actor), whoever asked for the sync. Approve, reject and PATCH use the
caller's actor (`user:…`, `mcp:…`). The access token is read through `plaid/tokens.ts` and passed only to
`plaid/transactions.ts`; it is never in a result, log line, change_log row, the DO's storage or an error
message (`PlaidApiError` carries only status and code).

### Balances and figures (note 12)

An unapproved import counts like any row from the moment it is written. **No query that sums or counts
`transactions` changes**: `countsInBalance()`, `activityByMonth`, `balancesByAccount`, reports and the payees
read are untouched. The new count queries (below) are new functions.

## What changes

**Migration `apps/worker/migrations/20261116100800_plaid_import.sql`** (additive, no row rewritten; every
existing row gets nulls): `transactions` + `import_id`, `source`, `imported_payee`, `bank_description`,
`import_date`, `import_amount`, `import_payee_name`; unique index `transactions_budget_import`; table
`import_tombstones` + index `(budget_id, import_id)`; `bank_connections` + `sync_error_since`, `sync_accounts`.

**Transaction resource** (`Transaction` schema, so every read and change_log copy): `import_id`, `source`
(`"plaid"` | null), `imported_payee`, `bank_description`, `matched` (boolean).

**Account resource**: `unapproved_count` (live, non-line rows with `approved = 0`) and
`needs_attention_count` (live, non-line rows that are unapproved **or** need a category: on-plan account,
no category, no Ready to Assign flag, not a split parent, not a transfer whose other account is on-plan, not
a Starting Balance). Both `.default(0)` in the schema; exact in the list/get reads and every response built
from `accountFacts`.

**Approve and reject (EXF-463, API only)**

| Operation | Body | Answer | MCP |
|---|---|---|---|
| `GET /budgets/{budget_id}/transactions?needs=approval_or_category` and `GET …/accounts/{account_id}/transactions?needs=…` | | same shape, only rows that need attention | `list_unapproved_transactions` |
| `POST /budgets/{budget_id}/transactions/approve` | `{ ids }` 1–100 | 200 `{ transactions }` after; 404 if any id unknown (nothing written) | `approve_transactions` |
| `POST /budgets/{budget_id}/transactions/reject` | `{ ids }` 1–100 | 200 `{ transactions }` as they were; 409 `transaction_approved`; 422 `not_imported` (nothing written) | `reject_transactions` |
| `POST /bank-connections/{id}/sync?budget_id=` | | 200 `SyncResult` | `sync_bank_connections` |
| `POST /budgets/{budget_id}/sync` | | 200 `{ results: SyncResult[] }` | `sync_bank_connections` |

`SyncResult = { bank_connection_id, status, added, matched, modified, removed, skipped, has_more,
last_synced_at }`. Approve sets `approved` on each row, its split lines and the other side of a transfer;
an approved row is returned unchanged with no write. Reject soft-deletes each row and writes its tombstone in
one batch per row group. **PATCH** approves an unapproved row unless the body sends `approved: false`;
`mirror()` carries approval to a transfer's other side. **DELETE** of a row with an `import_id` writes a
tombstone. `update_transaction`'s description says it approves; no `categorize_transaction` tool.

## Downstream effects

- Web: responses gain fields only (account counts default to 0, so stubbed e2e answers still parse). A web
  PATCH now approves.
- `packages/schema/test/register.test.ts` fixture gains the five transaction fields (typecheck).
- Coverage: `transactions.ts` file gains two operations, the two GETs list both tools;
  `bank-connections.ts` gains two operations. `mcp-timestamps.test.ts` gains three calls and one
  `NOT_CALLED` entry.

## Out of scope

EXF-463 screens (banner, pill, "i" menu, sidebar dot, bulk bar, Undo) · EXF-464 manual match, unmatch,
link icon · EXF-465 status display and repair · EXF-466 pending · EXF-467 renaming rules · EXF-515 2-of-3
category rule · joining two imports into a transfer · six-hourly cron · "Sync now" buttons · sync on app
open · new bank accounts appearing at the bank.

## Acceptance

Worker tests with the Plaid stand-in and made-up credentials. Default setup: Sandbox plan, connection via
`POST /bank-connections` (stub), checking account via `POST …/accounts/from-bank` with `today: 2026-03-10`.

1. **(462-1)** Stub page: posted outflow 12.34 and inflow 50 dated 2026-03-12, one pending. Sync → 200
   `added: 2`, `status: connected`; rows `approved false`, `cleared`, `source plaid`, `import_id` = Plaid id,
   amounts −12340 and 50000; no pending row.
2. **(462-2)** The inflow has `inflow_to_ready_to_assign true`; the outflow from a new payee has no category;
   after a hand row with payee "ZZ Cafe" and a category, an import from merchant "ZZ Cafe" takes it.
3. **(462-3)** Sync again (stub returns nothing new) → `added 0`, same rows, no new change_log rows. Sync
   with the cursor set back to null and the same page → `added 0`.
4. **(462-4)** Reject one import; set the cursor to null; sync the same page → not back. Same after a hand
   `DELETE`. Tombstone rows exist with reason `rejected` / `deleted`.
5. **(462-5)** Rows dated before `import_start_date`, before the Starting Balance date, and 4 days before
   the latest reconciled row (set reconciled in D1) → not imported, `skipped` counts them; 3 days before → imported.
6. **(462-6)** A later page adds one → imported. `removed` of an unapproved import → deleted, no tombstone;
   of an approved one → unchanged. `modified` of an unapproved import → date, amount, payee follow; of an
   approved one → only `bank_description` changes.
7. **(462-7)** change_log has a `create` row per import with actor `service:plaid`; no change_log text and no
   response contains any `SENTINEL` value.
8. **(462-8)** Connections with `last_synced_at` null, 7 h ago, 1 h ago, and null with status
   `login_required`: `scheduled()` syncs the first two only (their `last_synced_at` move, the others' do not).
9. **(462-9)** After success `last_synced_at` and the bank account balances change. Stub answers 400
   `ITEM_LOGIN_REQUIRED` → `status login_required`, cursor and `last_synced_at` unchanged; 500 → `delayed`.
10. **(462-10)** MCP `sync_bank_connections` with and without `bank_connection_id` → the same counts.
11. **(462-11)** `runSync` with a DB whose 2nd `batch` throws once → throws; next run → every import exactly
    once, cursor saved, change_log has one row per import.
12. **(462-12)** Two `POST …/sync` at once with a slow stub → one `/transactions/sync` call, equal answers.
13. **(462-13)** Hand outflow 12340 dated 3 days before an import of −12.34 → one row: hand payee, memo,
    date, category; `cleared`, `approved`, `matched true`, `import_id` set; `matched 1, added 0`. 12-day gap or
    12350 → no match, two rows. Two candidates 2 and 5 days away → the 2-day one.
14. **(462-14)** Linked account closed in D1 and an unlinked bank account → balances updated, no rows.
    Plan A imports N rows; plan B gets the same rows by hand → equal account balances and equal month read.
15. **(462-15)** One page of 500 added → `added 500`, 500 rows, 500 `create` change_log rows.
16. **(462)** `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` on page 2 once → the run restarts and
    imports each row once. Recovery: after a failed run, an import with the date and amount of an existing
    row is skipped (`recovery_duplicate`); without the failure it is imported.
17. **(463-a)** After a sync of N, `GET …/accounts` shows `unapproved_count N`, `needs_attention_count N`;
    `?needs=approval_or_category` returns exactly those N.
18. **(463-b)** Approve a categorized one → unapproved −1 and attention −1; an uncategorized one →
    unapproved −1, attention unchanged. Approving one side of a transfer approves the other.
19. **(463-c)** Reject → row gone; an approved id → 409 `transaction_approved`, nothing written; re-sync →
    not back.
20. **(463-d)** `PATCH {category_id}` on an unapproved import → `approved true`.
21. **(463-e)** The three tools do 17–20 with `mcp:` actors in change_log; `apiPaths()` and
    `listedToolNames()` include the four new paths and four new tools.

## Manifest

touches: [apps/worker/migrations/20261116100800_plaid_import.sql, apps/worker/src/db/schema/transactions.ts, apps/worker/src/db/schema/bank-connections.ts, apps/worker/src/db/schema/import-tombstones.ts, apps/worker/src/plaid/transactions.ts, apps/worker/src/durable/plaid-item-sync.ts, apps/worker/src/scheduled.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transaction-pairs.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/payees.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/routes/bank-connections.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/mcp/tools/accounts.ts, packages/schema/src/plaid-import.ts, packages/schema/src/transactions.ts, packages/schema/src/accounts.ts, packages/schema/src/bank-connections.ts, packages/schema/test/plaid-import.test.ts, packages/schema/test/register.test.ts, apps/worker/test/plaid-stub.ts, apps/worker/test/plaid-sync*.ts, apps/worker/test/transactions-approve.test.ts, apps/worker/test/mcp-coverage/transactions.ts, apps/worker/test/mcp-coverage/bank-connections.ts, apps/worker/test/mcp-timestamps.test.ts, docs/plaid-import-design.md, docs/plaid-import-spec.md, docs/README.md, docs/conventions.md]
shared: []
migrations: 1

Beyond note 15's list: `db/schema/bank-connections.ts` (two columns), `repositories/imports.ts`
(tombstones, new), `repositories/payees.ts` (insert by name), `services/transaction-pairs.ts` (approval
follows), `mcp/tools/accounts.ts` (count descriptions), `packages/schema/test/register.test.ts` (fixture),
`docs/conventions.md` (actor line).
