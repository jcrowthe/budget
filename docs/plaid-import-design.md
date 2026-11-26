# Plaid import design (EXF-462, Worker half of EXF-463)

Imports posted bank transactions from Plaid into linked plan accounts as **imported, unapproved** rows,
on a schedule and on request, with automatic matching and no double import; approve and reject them over
REST and MCP. **No screen changes**: nothing under `apps/web/` changes. Spec:
[plaid-import-spec.md](plaid-import-spec.md).

## Source

**Not compared: forbidden by the Lead; no screen changed** (a linked account in the source shows real bank
data). Behaviour comes from the two tickets (help-page rules) and the Lead's notes (rounds 66, 67; "note *n*"
= this Build's brief), which override them. No study notes, no screenshots; the proof against Plaid's
Sandbox is a later flow test on the live app. **Plaid calls added: `/transactions/sync` and `/accounts/get`
only; nothing creates, updates or removes a Plaid Item (note 13).**

## What exists (read in the code)

`plaidFor().post()`, `PlaidApiError(status, errorCode)`, `getAccessToken`, `plaidToMilliunits`;
`bank_connections` (unused `sync_cursor`); `bank_accounts` balances. A connection belongs to an environment,
so a bank account may be linked in **several plans**. Closing an account unlinks it. `insertIfStmt` lists
columns **positionally**; `mutate()` guards with `holdsAt`. `PlaidItemSync`, `scheduled()`: stubs (cron 03:00).

## Approach

Route, MCP or `scheduled()` → `requestSync` → DO `PlaidItemSync` (one per Item; coalesces) → `runSync`: read
state → Plaid pages → `/accounts/get` → pure decisions (`packages/schema/src/plaid-import.ts`, unit-tested)
→ guarded, idempotent write chunks → final batch (cursor, balances, `last_synced_at`, status).

### One run (`runSync(env, connectionId, opts)`)

1. **State.** Connection row; status `login_required` / `broken` → return it (no Plaid call, no write).
   Token (`getAccessToken`) missing → store `broken`. `plaidFor(env, row.environment)` throws
   `PlaidNotSetUp` → `not_set_up` (returned, not stored).
2. **Links.** Live accounts of live plans linked to the connection's bank accounts (`linkedToConnection`);
   `sync_accounts` = sorted `account_id:import_start_date` of the open ones. Stored set lacks one (a link
   newer than the cursor) → **full re-read** from a null cursor (see "Re-read"); else from `sync_cursor`.
   **No open linked account** (note 14): no `/transactions/sync` call; the run costs **one Plaid request**
   (`/accounts/get`), writes balances, `last_synced_at`, status, `sync_accounts = ''`, keeps both cursors.
3. **Fetch, bounded (note 10).** `/transactions/sync` (`count: 500`, `include_original_description`,
   `cursor` unless null or `''`) until `has_more` is false, or 500 updates held (`MAX_UPDATES_PER_RUN`), or 4
   pages read (`MAX_PAGES_PER_RUN`); the run's `has_more` is the last page's. The cursor reached is saved
   **with** what the run wrote; the next run goes on. Plaid restarts a `TRANSACTIONS_SYNC_MUTATION_DURING_
   PAGINATION` **from the first cursor of the pagination loop**, so a run ending with `has_more` keeps that
   start in `sync_loop_cursor` (`''` = start of feed, null = no open loop); on that error the run drops its
   pages and restarts from `sync_loop_cursor ?? run start` (3 restarts, then `delayed`). Then `/accounts/get`.
   **A Plaid error writes nothing** but the status (and `sync_error_since` when null) with its change_log row.
4. **Net changes** (`netChanges`): later pages win; `removed` drops an earlier `added`/`modified`; pending
   pending entries are split out (stored in `pending_transactions`: see pending-transactions-design.md); an
   unknown `modified` id is treated as `added` (rules still apply).
5. **Decide** per linked account (reads chunked at 90 ids, D1's 100-parameter limit): known ids,
   tombstones, Starting Balance date, latest reconciled date, match candidates, payees.
6. **Write** in chunks of ≤ 90 statements (`SYNC_STATEMENTS_PER_BATCH`); one import never straddles two.
   **Final batch**, guarded on `sync_cursor` = the value read in step 1: `sync_cursor`, `sync_loop_cursor`,
   `sync_accounts`, `last_synced_at`, `status connected`, `sync_error_since null`, balances, one
   `bank_connection` change_log row.

### Never twice (notes 1, 2)

- **Known import id** = a **live** row of the plan with that `import_id`, or a tombstone of the plan (also
  covers a row the user moved to another account). Unique index `transactions_budget_import (budget_id, import_id) WHERE import_id IS NOT NULL
  AND deleted_at IS NULL`: a second live insert is impossible in any account.
- **Tombstone** `import_tombstones (account_id, import_id)` primary key, plus `budget_id`, `reason`
  (`rejected` | `deleted` | `duplicate`), `transaction_id` (null for `duplicate`), `created_at`. Written by
  reject and by **every user deletion of a row that carries an `import_id`** (DELETE, and the other side of a
  deleted transfer), in the same batch; and by a `recovery_duplicate` skip (reason `duplicate`), so a later
  re-read, which runs without the recovery rule, cannot insert that copy. A deleted row without a tombstone
  is only ever a **bank removal** ("may come back"), which is why the index and the check look at live rows
  only.
- **Ordering**: cursors last. A crash after chunk *k* repeats from the old cursor; every statement is then a
  no-op (inserts guarded by "not known", matches by `holdsAt`, updates re-decided from fresh reads, payees
  inserted if missing, referenced by name): **a repeat changes nothing**, change_log included.

### Never import, pure `skipReason`

| reason | rule |
|---|---|
| `pending` | `pending: true`: never a `transactions` row. Stored in `pending_transactions` (see pending-transactions-design.md), not counted in `skipped` |
| `account_closed` | the plan account is closed (the write is also guarded: account live, open, still linked to that bank account) |
| `before_start` | `date < import_start_date` or `date <` the live Starting Balance row's date |
| `before_reconciled` | `date < latest reconciled date − 3 days` (`latestReconciledDate`) |
| `known` | known import id (above) |
| `recovery_duplicate` | the run "came back", no match was found, and a live row of the account has the same date and amount (writes a `duplicate` tombstone) |

**"Came back"** (EXF-465 not built): `bank_connections.sync_error_since` is set by the first failed run and
cleared by the next successful run. A run that **starts** with it set applies `recovery_duplicate`. A repair
(`finishReset` sets `connected`) leaves it set, so the first sync after a repair also applies it.

### Writing an import

`amount = 0 − plaidToMilliunits(t.amount)`; `date`; `cleared`; `approved false`; `source 'plaid'`; `import_id
= transaction_id`; `imported_payee = name`; `bank_description = original_description ?? name`;
`import_date/amount/payee_name` = the bank's values (for EXF-464's unmatch). **Payee**: `(merchant_name ||
name)` trimmed, ≤ 200 chars, empty → none; exact name among the plan's live **ordinary** payees, else created
once per run. **Category** (`categoryFor`): no-category account (tracking, loan) → none; else the payee's
`last_category_id`; else an inflow into checking or savings → Ready to Assign; else none. A bank account
linked in two plans gets one import in each; two imports of one transfer stay two plain rows.

### Automatic matching (note 4), pure `pickMatch`

Candidates: live non-line rows of the same account, `import_id IS NULL AND source IS NULL` (hand-entered,
never matched), same `amount`, dates ≤ 10 days apart. Closest date, then oldest `created_at`, then id; a
candidate is used once per run. A split parent matches by its total; a transfer row of this account can.
The matched row keeps payee, memo, date, amount and category; it takes `import_id`, `imported_payee`,
`bank_description`, `import_*` (**stored for a later unmatch**), `cleared` (stays `reconciled`), `approved
true`; split lines follow; `source` stays NULL. **`matched` = `import_id IS NOT NULL AND source IS NULL`.**
The update is guarded by the candidate's `holdsAt`, then the import's own insert by "not known": if the
user edits the candidate meanwhile, the import is inserted as its own row.

### Modified, removed and re-read (notes 9, 11), pure `modifiedPlan` / `removedPlan`

An entry whose `import_id` is on a **live row of the plan** is "already imported", whether it arrives as
`modified` **or as `added`** (a re-read sends everything as `added`): never inserted, and:
- **Reconciled** (`cleared = 'reconciled'`), whatever else: only `bank_description` may change; `removed`
  does nothing. Never its amount, date, payee, `cleared` or `import_*` (note 11).
- **Unapproved and unmatched** (`approved = 0 AND source = 'plaid'`): follows the bank (date, amount, payee
  as for an insert, `imported_payee`, `bank_description`, `import_*`); `removed` soft-deletes it, **no
  tombstone**.
- **Anything else** (approved, edited, matched): only `bank_description` and the internal `import_*` copies
  (not in the API); `removed` does nothing.
- An update whose values are already there writes **nothing** (no statement, no change_log row). Each
  statement is guarded on the row's `updated_at` as read: a user edit during the run wins. Counted in
  `modified` only when written.

**Re-read** (note 3, sharpened by note 9): so a full re-read leaves approved, edited, matched and reconciled
rows exactly as they were, never brings back a rejected, deleted or duplicate-skipped entry (tombstone →
`known`), and imports only what is new to the plan (the later-linked account's rows, by the normal rules
and matching).

### Concurrency (note 6)

`PlaidItemSync.fetch` keeps `running: Promise<SyncResult> | null` in memory; a request during a run awaits
the same promise. It stores **nothing** (the token is read per run). `requestSync` →
`PLAID_ITEM_SYNC.get(idFromName(plaid_item_id))`, `POST https://plaid-item-sync/run {connection_id}`;
non-200 throws (route 500).

### When it runs (note 6)

- `POST /bank-connections/{id}/sync?budget_id=` (the plan picks the environment) → one run.
- `POST /budgets/{budget_id}/sync` → each connection of the plan's environment linked to a live account of
  the plan, in turn.
- `scheduled()` → `syncDueConnections`: every connection (both environments), `last_synced_at` null or
  older than 6 h, status not `login_required`/`broken`; up to 5 runs each while `has_more`; one
  connection's error is caught and the next goes on. Right at any cron frequency; `wrangler.jsonc` untouched.

### Statuses

`connected` · `delayed` (network, 5xx, rate limit, institution down, restarts used up, unknown code) ·
`login_required` (credential and consent codes, listed in the spec) · `broken` (no token, `ITEM_NOT_FOUND`,
`INVALID_ACCESS_TOKEN`) · `not_set_up` (no credentials; returned, never stored). A status change is one
`bank_connection` change_log row.

### History and secrets (note 8)

Every insert, match, update, delete and payee of a sync, and the connection update, has a change_log row
with actor **`service:plaid`** (one line in `docs/conventions.md`), whoever asked. Approve, reject, PATCH:
the caller's actor. The access token goes from `plaid/tokens.ts` only to `plaid/transactions.ts`; never in a
result, log line, change_log row, DO storage or error (`PlaidApiError` holds status and code); the sync's
only log line is `console.error` with the connection id.

### Balances and figures (note 12)

An unapproved import counts like any row from the moment it is written. **No query that sums or counts
`transactions` changes**: `countsInBalance()`, `activityByMonth`, `balancesByAccount`, reports and the payees
read are untouched. The new count queries (below) are new functions.

## What changes

**Migration `apps/worker/migrations/20261116100800_plaid_import.sql`** (additive, no row rewritten; every
existing row gets nulls): `transactions` + `import_id`, `source`, `imported_payee`, `bank_description`,
`import_date`, `import_amount`, `import_payee_name`; unique index `transactions_budget_import`; table
`import_tombstones` + index `(budget_id, import_id)`; `bank_connections` + `sync_error_since`, `sync_accounts`, `sync_loop_cursor`.

**Transaction resource** (`Transaction` schema, so every read and change_log copy): `import_id`, `source`
(`"plaid"` | null), `imported_payee`, `bank_description`, `matched` (boolean).

**Account resource**: `unapproved_count` (live non-line rows, `approved = 0`) and `needs_attention_count`
(live non-line rows unapproved **or** needing a category: on-plan account, no category, no Ready to Assign
flag, not a split parent, not a transfer to an on-plan account, not a Starting Balance). `.default(0)` in the
schema; exact in every read built from `accountFacts`.

**Approve and reject (EXF-463, API only)**

| Operation | Body | Answer | MCP |
|---|---|---|---|
| `GET …/transactions?needs=approval_or_category` (plan and account lists) | | same shape, rows needing attention | `list_unapproved_transactions` |
| `POST /budgets/{budget_id}/transactions/approve` | `{ ids }` 1–100 | 200 `{ transactions }` after; 404 any unknown | `approve_transactions` |
| `POST /budgets/{budget_id}/transactions/reject` | `{ ids }` 1–100 | 200 `{ transactions }` as they were; 409 `transaction_approved`; 422 `not_imported` | `reject_transactions` |
| `POST /bank-connections/{id}/sync?budget_id=` | | 200 `SyncResult` | `sync_bank_connections` |
| `POST /budgets/{budget_id}/sync` | | 200 `{ results: SyncResult[] }` | `sync_bank_connections` |

`SyncResult = { bank_connection_id, status, added, matched, modified, removed, skipped, has_more,
last_synced_at }`. Tool descriptions (note 15): money in milliunits, outflows negative, Plaid's opposite sign
converted; `sync_bank_connections` contacts the bank and may add, change and delete unapproved transactions;
`reject_transactions` is refused for an approved one; `update_transaction`: saving approves.

Approve sets `approved` on each row, its split lines and the other side of a transfer; an approved row is
returned unchanged with no write. A refused request writes nothing. Reject soft-deletes each row and writes its tombstone in
one batch per row group. **PATCH** approves an unapproved row unless the body sends `approved: false`;
`mirror()` carries approval to a transfer's other side. **DELETE** of a row with an `import_id` writes a
tombstone. No `categorize_transaction` tool.

## Downstream effects

- Web: responses gain fields only (account counts default to 0, so stubbed e2e answers still parse). A web
  PATCH now approves.
- `packages/schema/test/register.test.ts` fixture gains the five transaction fields (typecheck).
- Coverage: `transactions.ts` gains two operations, the two GETs list both tools; `bank-connections.ts`
  gains two. `mcp-timestamps.test.ts` gains four calls, each next to its resource's calls; `NOT_CALLED`
  stays empty.

## Out of scope

EXF-463 screens (banner, pill, "i" menu, sidebar dot, bulk bar, Undo) · EXF-464 manual match, unmatch,
link icon · EXF-465 status display and repair · EXF-467 renaming rules · EXF-515 2-of-3
category rule · joining two imports into a transfer · six-hourly cron · "Sync now" buttons · sync on app
open · new bank accounts appearing at the bank.

## Acceptance

Worker tests, Plaid stand-in, `SENTINEL` credentials; never Plaid, never the live app. Setup: Sandbox plan,
connection via `POST /bank-connections` (stub), checking via `POST …/accounts/from-bank`, `today: 2026-03-10`.

1. **(462-1)** Outflow 12.34, inflow 50 (2026-03-12), one pending. Sync → `added: 2`, `connected`; rows
   `approved false`, `cleared`, `source plaid`, `import_id` = Plaid id, −12340 / 50000; no pending row.
2. **(462-2)** The inflow has `inflow_to_ready_to_assign true`; the outflow (new payee) no category; after a
   hand row with payee "ZZ Cafe" and a category, an import from merchant "ZZ Cafe" takes that category.
3. **(462-3)** Sync again, and again with the cursor nulled → `added 0`, same rows, no new change_log rows.
4. **(462-4)** Reject one import; cursor null; same page → not back. Same after a hand `DELETE`. Tombstones
   with reason `rejected` / `deleted`.
5. **(462-5)** Dated before `import_start_date`, before the Starting Balance date, 4 days before the latest
   reconciled row (reconciled set in D1) → not imported, counted in `skipped`; 3 days before → imported.
6. **(462-6)** A later page adds one → imported. `removed` of an unapproved import → deleted, no tombstone; of
   an approved one → unchanged. `modified` of an unapproved import → date, amount, payee follow; of an
   approved one → only `bank_description`.
7. **(462-7)** change_log has one `create` row per import, actor `service:plaid`.
8. **(462-8)** Connections with `last_synced_at` null, 7 h ago, 1 h ago, and null + `login_required`:
   `scheduled()` syncs the first two only.
9. **(462-9)** Success moves `last_synced_at` and the balances. 400 `ITEM_LOGIN_REQUIRED` → `login_required`,
   cursor and `last_synced_at` unchanged; 500 → `delayed`.
10. **(462-10)** MCP `sync_bank_connections` with and without `bank_connection_id` → the same counts.
11. **(462-11, Lead)** `runSync` with a DB whose 2nd `batch` throws once → throws, cursor unchanged; next run
    → every import exactly once, cursor saved, one change_log `create` per import, no second live copy.
12. **(462-12, Lead)** Two `POST …/sync` at once with a slow stub → one `/transactions/sync` call, equal
    answers.
13. **(462-13)** Hand outflow 12340 three days before an import of −12.34 → one row: hand payee, memo, date,
    category; `cleared`, `approved`, `matched true`, `import_id` set; `matched 1, added 0`. 12-day gap or
    12350 → two rows. Candidates 2 and 5 days away → the 2-day one.
14. **(462-14, note 14)** A linked account closed in D1, and an unlinked bank account → balances updated, no
    rows. A connection with no linked account → one Plaid call (`/accounts/get`), balances and
    `last_synced_at` updated, `sync_cursor` unchanged.
15. **(462-15)** One page of 500 added → `added 500`, 500 rows, 500 `create` rows.
16. **(462)** Mutation error on page 2 once → restart, each row once. After a failed run, an import with
    the date and amount of an existing row is skipped, tombstoned `duplicate`, and not inserted by a later
    re-read; without the failure it is imported.
17. **(463-a)** After a sync of N, `GET …/accounts` shows `unapproved_count N`, `needs_attention_count N`;
    `?needs=approval_or_category` returns exactly those N.
18. **(463-b)** Approve a categorized one → unapproved −1, attention −1; an uncategorized one → unapproved
    −1, attention unchanged. Approving one side of a transfer approves the other.
19. **(463-c)** Reject → row gone; an approved id → 409 `transaction_approved`, nothing written; re-sync → not
    back.
20. **(463-d)** `PATCH {category_id}` on an unapproved import → `approved true`.
21. **(463-e)** The three tools do 17–20 with `mcp:` actors; `apiPaths()` and `listedToolNames()` include the
    four new paths and four new tools.
22. **(note 9) Later link.** A linked; six entries; a hand row matching entry 4. Sync. Approve row 1;
    `PATCH` row 2 (memo, category); reject row 3; row 5 `reconciled` in D1; row 6 unapproved. Snapshot A's
    rows (all columns, deleted too) and change_log count. Link B to the second bank account; sync: the stub
    gets **no** cursor and serves A's six again as `added` plus B's. A's rows equal the snapshot column for
    column (`updated_at` too), row 3 not back, no change_log row for A; B's rows imported.
23. **(note 11)** `modified` with new amount, date, name and description for a reconciled import → only
    `bank_description` changes; `removed` of a reconciled unapproved import → kept; a reconciled hand row
    matched → stays `reconciled`, date, amount, payee unchanged.
24. **(note 10) Bounded run.** Six pages of 100 → run 1: `has_more true`, 400 rows, `sync_cursor` = page 4's,
    `sync_loop_cursor ''`; run 2: 600 rows, `has_more false`, loop cursor null. Variant: run 2's first call
    answers the mutation error once → next call has no cursor; 600 rows, each once. `scheduled()` on the
    same feed does both runs.
25. **(Lead) Same as by hand.** Plan A imports N rows (Ready to Assign and payee-categorized); plan B gets
    them by hand → equal account balances and equal month read (activity, available, Ready to Assign).
26. **(Lead) No token.** Over a success, a 400, a 500 and a thrown fetch, with `console.*` spied: no
    response, log argument or `change_log` text (whole table) holds any `SENTINEL` value.

## Per-run budget and failed runs (EXF-613)

Details: [sync-budget-design.md](sync-budget-design.md).
- **Budget.** One run makes at most 45 calls (`RUN_CALL_BUDGET`). A call is a D1 statement or a `db.batch`, or
  a Plaid call, and the final batch counts.
- **Reads.** Names are read once per plan; match-candidate lines once per unit. The per-account reads go into
  one batch.
- **Budget stop.** A run stopped by the budget writes what it decided in order, then a final batch *without*
  cursors, link set or `sync_error_since`, and reports `has_more`. The next run reads the same entries again,
  and the ones already written are no-ops.
- **Failed runs.** A run that fails in Budget sets `delayed` and the new `sync_failed_at`, with a change_log
  row, and keeps the cursor. The next finished run clears it.
- **Schedule.** `syncDueConnections` runs connections round-robin, at most 40 runs and 10 minutes per
  invocation.

## Manifest

touches: [apps/worker/migrations/20261116100800_plaid_import.sql, apps/worker/src/db/schema/transactions.ts, apps/worker/src/db/schema/bank-connections.ts, apps/worker/src/db/schema/import-tombstones.ts, apps/worker/src/plaid/transactions.ts, apps/worker/src/durable/plaid-item-sync.ts, apps/worker/src/scheduled.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transaction-pairs.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/payees.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/routes/bank-connections.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/mcp/tools/accounts.ts, packages/schema/src/plaid-import.ts, packages/schema/src/transactions.ts, packages/schema/src/accounts.ts, packages/schema/src/bank-connections.ts, packages/schema/test/plaid-import.test.ts, packages/schema/test/register.test.ts, apps/worker/test/plaid-stub.ts, apps/worker/test/plaid-sync*.ts, apps/worker/test/transactions-approve.test.ts, apps/worker/test/mcp-coverage/transactions.ts, apps/worker/test/mcp-coverage/bank-connections.ts, apps/worker/test/mcp-timestamps.test.ts, docs/plaid-import-design.md, docs/plaid-import-spec.md, docs/README.md, docs/conventions.md]
shared: []
migrations: 1

