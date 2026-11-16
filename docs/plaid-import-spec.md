# Plaid import spec (EXF-462, Worker half of EXF-463)

Build from [plaid-import-design.md](plaid-import-design.md). Tasks in order; each ends with how to verify.
Always: no file under `apps/web/` nor any file the brief puts out of bounds; tests never call Plaid nor read
`PLAID_*` variables (use `SENTINEL`); the six protected test files stay unedited.

## T1. Migration and tables

`apps/worker/migrations/20261116100800_plaid_import.sql`:

```sql
ALTER TABLE transactions ADD COLUMN import_id TEXT;
ALTER TABLE transactions ADD COLUMN source TEXT;            -- 'plaid' for an import; NULL hand-entered
ALTER TABLE transactions ADD COLUMN imported_payee TEXT;    -- Plaid name, raw
ALTER TABLE transactions ADD COLUMN bank_description TEXT;  -- original_description ?? name
ALTER TABLE transactions ADD COLUMN import_date TEXT;       -- the bank's values, for EXF-464 unmatch
ALTER TABLE transactions ADD COLUMN import_amount INTEGER;
ALTER TABLE transactions ADD COLUMN import_payee_name TEXT;
CREATE UNIQUE INDEX transactions_budget_import ON transactions (budget_id, import_id)
  WHERE import_id IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE import_tombstones (
  account_id TEXT NOT NULL, import_id TEXT NOT NULL, budget_id TEXT NOT NULL,
  reason TEXT NOT NULL, transaction_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, import_id));
CREATE INDEX import_tombstones_budget ON import_tombstones (budget_id, import_id);
ALTER TABLE bank_connections ADD COLUMN sync_error_since TEXT;
ALTER TABLE bank_connections ADD COLUMN sync_accounts TEXT;
ALTER TABLE bank_connections ADD COLUMN sync_loop_cursor TEXT; -- '' = loop began at feed start; NULL = none open
```

- `db/schema/transactions.ts`: the seven columns **appended after `splitIndex`, in this order**
  (`importId, source (enum ["plaid"]), importedPayee, bankDescription, importDate, importAmount,
  importPayeeName`) and the partial unique index.
- `db/schema/import-tombstones.ts`: `importTombstones` (reason enum `["rejected","deleted","duplicate"]`),
  PK and index.
- `db/schema/bank-connections.ts`: `syncErrorSince`, `syncAccounts`, `syncLoopCursor`.
- Delete `.e2e-state`.

Verify: `schema-drift.test.ts` passes.

## T2. Repository plumbing for the new columns

`repositories/transactions.ts`:
- `TransactionRow`: the seven columns optional like `LinkCols` (insert as null).
- `insertIfStmt`: append the seven values to the `select`, after `splitIndex`, `?? null` each.
- `TxSet`: add the seven columns.
- `needsAttention(): SQL` — raw SQL over `transactions` (design "Account resource"): `approved = 0 OR (
  category_id IS NULL AND inflow_to_ready_to_assign = 0 AND exists(account on_budget = 1) AND no live line
  AND NOT (transfer_account_id IS NOT NULL AND exists(other account on_budget = 1)) AND coalesce(payee
  system,'') <> 'starting_balance')`, with sub-selects (no join needed).
- `listDetailForAccount` / `listDetailForPlan`: optional `needs?: "approval_or_category"` adds `needsAttention()`.
- `attentionCountsByAccount(db, budgetId, accountId?) → Map<accountId, {unapproved, attention}>` over
  `countsInBalance()` rows. **Do not change `countsInBalance`, `balancesByAccount`, `activityByMonth`,
  `openAccountsBalances`.**

`repositories/imports.ts` (new):
- `knownImportIds(db, budgetId, ids): Promise<Set<string>>` — live rows with `import_id IN chunk` ∪
  tombstones of the plan; chunks of 90.
- `notKnownSql(budgetId, importId): SQL` — `not exists live row … and not exists tombstone …`.
- `tombstoneIfStmt(db, {accountId, importId, budgetId, reason, transactionId}, guard)` — `insert … select …
  where exists guard` + `onConflictDoNothing()`.
- `rowsByImportId(db, budgetId, ids)` — live rows (`TransactionRow`) with those ids (chunked).
- `matchCandidates(db, accountId, from, to)` — live, `parent_transaction_id IS NULL`, `import_id IS NULL`,
  `source IS NULL`, `date BETWEEN from AND to`: `{id, date, amount, createdAt, updatedAt, row}`.
- `liveDateAmounts(db, accountId, from, to)` — `{date, amount}` of live non-line rows (recovery check).
- `accountLinkedOpenSql(accountId, bankAccountId)` — account live, not closed, `bank_account_id` = it.

`repositories/accounts.ts`: `startingBalanceDate(db, accountId)` (min date of live rows whose payee system is
`starting_balance`).

`repositories/payees.ts`: `insertByNameIfMissingStmt(db, row)` (insert … select … where not exists a live
ordinary payee of the plan with that name); `ordinaryIdByNameSql(budgetId, name)` (the `payeeIdSql` for
`insertIfStmt`); `missingByNameSql` for the change_log guard.

`repositories/bank-connections.ts`: `updateConnectionStmt` set type gains `syncCursor`, `lastSyncedAt`,
`syncErrorSince`, `syncAccounts`, `syncLoopCursor`; `cursorIs(cursor)` guard; `updateBalancesStmt(db,
bankAccountId, {current, available, at})`; `listDue(db, before: string)` (status not in `login_required`/`broken`, `last_synced_at`
null or `<` before, both environments); `listForPlanLinks(db, budgetId, environment)` (connections with a
bank account linked to a live account of the plan).

Verify: `pnpm check`; existing transaction tests pass unchanged.

## T3. Schemas

`packages/schema/src/transactions.ts` — `Transaction` gains `import_id: string|null`, `source:
z.enum(["plaid"]).nullable()`, `imported_payee`, `bank_description` (string|null), `matched: boolean`.
New: `TransactionIdsRequest = { ids: z.array(z.string().min(1)).min(1).max(100) }` (strict; duplicates
removed by the service), `TransactionsResponse = dataEnvelope({ transactions: TransactionDetail[] })`,
`TRANSACTION_NEEDS = ["approval_or_category"]`. Update the fixture in `packages/schema/test/register.test.ts`.

`packages/schema/src/accounts.ts` — `Account` gains `unapproved_count` and `needs_attention_count`:
`z.number().int().min(0).default(0)` with descriptions.

`packages/schema/src/bank-connections.ts` — `SyncStatus = z.enum(SYNC_STATUSES)`; `SyncResult` (design);
`SyncResultResponse = dataEnvelope(SyncResult)`, `PlanSyncResponse = dataEnvelope({ results:
SyncResult[] })`; `BankConnection.status` description lists the statuses.

## T4. Pure decisions: `packages/schema/src/plaid-import.ts` (no imports from core or the Worker)

```ts
export const SYNC_STATUSES = ["connected","delayed","login_required","broken","not_set_up"] as const;
export const NEEDS_REPAIR: readonly SyncStatus[] = ["login_required","broken"];
export const DUE_AFTER_MS = 6 * 3600_000, MATCH_WINDOW_DAYS = 10, RECONCILED_GRACE_DAYS = 3;
export const MAX_UPDATES_PER_RUN = 500, MAX_PAGES_PER_RUN = 4;
export interface PlaidTxn { transaction_id; account_id; amount: number; date; name: string|null;
  merchant_name: string|null; original_description: string|null; pending: boolean }
export function syncStatusForError(httpStatus: number, code: string|null): Exclude<SyncStatus,"connected"|"not_set_up">;
export function netChanges(pages: {added; modified; removed: {transaction_id}[]}[]):
  { upserts: { txn: PlaidTxn; kind: "added"|"modified" }[]; removed: string[] };   // pending dropped
export function minusDays(date: string, n: number): string;  export function daysApart(a, b): number;
export function payeeNameOf(t): string | null;               // (merchant_name || name).trim().slice(0,200) || null
export function bankDescriptionOf(t): string | null;         // original_description ?? name
export type SkipReason = "account_closed"|"before_start"|"before_reconciled"|"known"|"recovery_duplicate";
export function skipReason(t: {date}, a: { closed; importStartDate; startingBalanceDate; latestReconciledDate },
  known: boolean): SkipReason | null;                         // order: closed, start, reconciled, known
export interface Candidate { id; date; amount; createdAt }
export function pickMatch(imp: {date; amount}, cs: Candidate[], used: ReadonlySet<string>): string | null;
export function isRecoveryDuplicate(imp: {date; amount}, existing: {date; amount}[]): boolean;
export function categoryFor(a: { takesCategory: boolean; rtaInflow: boolean }, amount: number,
  payee: { lastCategoryId: string|null } | null): { categoryId: string|null; inflowToReadyToAssign: boolean };
type Held = { approved: boolean; source: string|null; cleared: "uncleared"|"cleared"|"reconciled" };
export function modifiedPlan(row: Held): "follow"|"description_only"|"bank_description_only"; // reconciled first
export function removedPlan(row: Held): "delete"|"keep";      // delete only unapproved, plaid, not reconciled
export function isDue(lastSyncedAt: string|null, status: string, nowMs: number): boolean;
export function linkSet(accounts: {id; importStartDate: string|null}[]): string;  // sorted "id:date" joined by ","
```

`packages/schema/test/plaid-import.test.ts`: each rule with its edge — 3 vs 4 days before reconciled,
date equal to `import_start_date` imported, 10 vs 11 days, closest then oldest, used candidate skipped,
mutation code → `delayed`, each `login_required` code (`ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`,
`PENDING_DISCONNECT`, `ACCESS_NOT_GRANTED`, `USER_PERMISSION_REVOKED`, `ITEM_LOCKED`, `INVALID_CREDENTIALS`,
`INVALID_MFA`, `INVALID_UPDATED_USERNAME`, `INSUFFICIENT_CREDENTIALS`, `USER_SETUP_REQUIRED`,
`MFA_NOT_SUPPORTED`, `NO_ACCOUNTS`), `ITEM_NOT_FOUND` → `broken`, status 0 → `delayed`,
removed-after-added dropped, pending dropped, `-0` never produced, `isDue` at exactly 6 h, a reconciled row
→ `bank_description_only` / `keep` whatever `approved` and `source`.

Verify: `pnpm --filter @budget/schema test` (or `pnpm check`).

## T5. Plaid calls: `apps/worker/src/plaid/transactions.ts`

- Types of the two answers (`SyncPage { added, modified, removed, next_cursor, has_more }`,
  `BalanceAccount { account_id, balances: { current, available, last_updated_datetime } }`).
- `fetchSyncPages(plaid, accessToken, startCursor: string|null, loopCursor: string|null, opts { maxUpdates
  = 500, maxPages = 4, maxRestarts = 3 }) → { pages, nextCursor, hasMore }`. Body `{ access_token, count:
  500, options: { include_original_description: true }, ...(cursor ? { cursor } : {}) }` (`''` and null
  send no cursor). Stops after the page on which `has_more` is false, or the updates held reach
  `maxUpdates`, or `maxPages` pages. On `PlaidApiError` code `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`:
  drop pages, restart from `loopCursor ?? startCursor`; after `maxRestarts` rethrow.
- `fetchBalances(plaid, accessToken) → BalanceAccount[]` (`/accounts/get`).
- Nothing else; never logs; the token is only in the request body.

## T6. The sync: `apps/worker/src/services/plaid-sync.ts`

```ts
export const PLAID_ACTOR = "service:plaid";
export const SYNC_STATEMENTS_PER_BATCH = 90, MAX_RUNS_PER_CONNECTION = 5;
export async function runSync(env: Env, connectionId: string, opts?: { maxUpdates?: number; maxPages?: number }): Promise<SyncResult>;
export async function requestSync(env: Env, conn: BankConnectionRow): Promise<SyncResult>;   // via the DO
export async function syncBankConnection(env: Env, budgetId: string, id: string): Promise<SyncResult>;  // scoped like getBankConnection, then requestSync
export async function syncPlan(env: Env, budgetId: string): Promise<{ results: SyncResult[] }>;   // 404 plan
export async function syncDueConnections(env: Env, now?: Date): Promise<SyncResult[]>;
```

`runSync`, following the design's "One run" steps 1–6:
- Early exits return `{ status, added:0, matched:0, modified:0, removed:0, skipped:0, has_more:false,
  last_synced_at: row.lastSyncedAt }`. Missing token → store `broken` (with change_log) and return it.
- Error path: one batch — `changeLogInsertIf(bank_connection update, before/after toApi)` and
  `updateConnectionStmt({ status, syncErrorSince: row.syncErrorSince ?? now, updatedAt })`; only when the
  status or `syncErrorSince` changes. Never touches `syncCursor` / `lastSyncedAt`.
- **No open linked account**: skip `fetchSyncPages`; `fetchBalances` only; final batch without cursor
  changes (`syncAccounts: ""`).
- Start: `fresh = linkSet ⊄ stored sync_accounts` → start cursor null, loop cursor `''`; else
  `row.syncCursor` / `row.syncLoopCursor`.
- Per linked account (open, plan live): `takesCategory = isOnBudget(type) && !isLoanType(type)`,
  `rtaInflow = type === "checking" || type === "savings"`; payees from `payeesRepo.listForPlan(db, budgetId,
  { includeHidden: true })` filtered to `system === null`, by exact name.
- Process upserts sorted by `date`, then `transaction_id`. For each, for each plan account linked to its
  `account_id`'s bank account:
  - existing live row with that `import_id` in the plan → **for kind `added` and `modified` alike** (a
    re-read sends `added`) → `modifiedPlan`: `follow` builds the new values (date, amount, payee via
    find-or-create, `imported_payee`, `bank_description`, `import_*`); `description_only` sets
    `bank_description` and `import_*`; `bank_description_only` (reconciled) sets only `bank_description`.
    Never an insert. No statement when nothing differs; `modified` counts written updates only.
    Statements: `changeLogInsertIf(update, g)`, `updateIfStmt(…, g)`, `g = writtenAt(db, id, row.updatedAt)`.
  - else `skipReason` → count `skipped`.
  - else `pickMatch` → statements: log + `updateIfStmt(candidate, {importId, importedPayee, bankDescription,
    import*, cleared: reconciled ? "reconciled" : "cleared", approved: true, updatedAt}, allHold([holdsAt(c),
    notKnown]))`, then `syncLinesIfStmt` for a split parent (guard: row has that `import_id`), then the
    fallback insert below. Count `matched` when the update's `changes > 0`.
  - else if the run started with `syncErrorSince` set and `isRecoveryDuplicate` → `skipped`, plus
    `tombstoneIfStmt({reason "duplicate", transactionId: null})` guarded by `notKnownSql`.
  - else insert: optional payee `insertByNameIfMissingStmt` (+ its log guarded by `missingByNameSql`), then
    `changeLogInsertIf(create, g)` and `insertIfStmt(row, g, ordinaryIdByNameSql(…))` with
    `g = select 1 where notKnownSql AND accountLinkedOpenSql`. Count `added` by `changes > 0`.
- Removed ids: live row in the plan with that id and `removedPlan` = `delete` → log + `softDeleteIfStmt`
  guarded by `writtenAt(row.updatedAt)`. No tombstone. Count `removed`.
- A row's change_log `after` uses the transaction log shape (export a `transactionLogShape(row, names)` from
  `services/transactions.ts` rather than copying it).
- Chunks: group each import's statements; flush when the next group would pass 90 statements.
- Final batch (guard `cursorIs(row.syncCursor)` as read): connection change_log (`before`/`after` `toApi`),
  `updateConnectionStmt({ syncCursor: nextCursor, syncLoopCursor: hasMore ? (loopCursor ?? startCursor ??
  "") : null, syncAccounts: linkSet, lastSyncedAt: now, status: "connected", syncErrorSince: null,
  updatedAt })`, then `updateBalancesStmt` per known bank account (`plaidToMilliunits` of `current` /
  `available`, `balance_updated_at = last_updated_datetime ?? now`), linked or not.
- Results: `has_more` from `fetchSyncPages`; `last_synced_at` = now on success.

`requestSync`: `env.PLAID_ITEM_SYNC.get(env.PLAID_ITEM_SYNC.idFromName(conn.plaidItemId)).fetch(
"https://plaid-item-sync/run", { method: "POST", body: JSON.stringify({ connection_id: conn.id }) })`; not
ok → `throw new Error("sync failed")` (no detail). `syncDueConnections`: `listDue(now − 6 h)`; per connection
loop `requestSync` while `has_more` and runs < 5; `try/catch` per connection (`console.error` with the
connection id only).

## T7. Durable Object and schedule

`durable/plaid-item-sync.ts`: `running: Promise<SyncResult> | null`; `fetch` parses `{ connection_id }`
(400 otherwise), `this.running ??= runSync(this.env, id).finally(() => { this.running = null; })`, answers
`Response.json(await this.running)`; a rejection answers 500 `{ error: "sync_failed" }`. No `ctx.storage` use.
`scheduled.ts`: `ctx.waitUntil(syncDueConnections(env))` and await it; keep the TODO line.

## T8. Approve, reject, PATCH, DELETE (`services/transactions.ts`, `services/transaction-pairs.ts`)

- `transactionToApi` adds the five fields (`matched = importId != null && source == null`).
- `prepare()`: `approved: p.approved ?? true` (an edit approves).
- `mirror()`: `approved: self.approved || other.approved`; `sameSide` also compares `approved`.
- `mutate()` delete path: for `before` and each `others` row of kind `delete` with an `importId`, push
  `tombstoneIfStmt(…, reason "deleted", guard)` into the same batch.
- `approveTransactions(env, actor, budgetId, ids)`: dedupe; read every `findDetail` first (any missing →
  `NotFound`); for each unapproved row: log + `updateIfStmt(id, {approved: true, updatedAt}, holdsAt(row))`,
  `syncLinesIfStmt` for a split parent, and the other side of a transfer (log + update when unapproved);
  chunked at 90 statements; returns `detailOf` for each id in input order. Retry a row whose guard lost
  (re-read, up to `MAX_ATTEMPTS`), then `Conflict`.
- `rejectTransactions(env, actor, budgetId, ids)`: read all; missing → `NotFound`; any approved →
  `TransactionRefused(409, "transaction_approved", …)`; any without `importId` →
  `TransactionRefused(422, "not_imported", …)`; then per row, in one batch per ≤ 30 rows: log (delete),
  `softDeleteIfStmt`, `tombstoneIfStmt(reason "rejected")`, all guarded by `holdsAt(row)`; returns the rows
  as they were.
- `listAccountTransactions` / `listPlanTransactions` take `needs?`.

`services/accounts.ts`: `AccountFacts` gains `unapproved` and `attention` from
`attentionCountsByAccount`; `accountToApi` writes `unapproved_count` / `needs_attention_count` (default 0).

Verify: existing `transactions*.test.ts`, `transfers.test.ts`, `splits.test.ts`, `accounts*.test.ts` pass.

## T9. Routes

`routes/transactions.ts`: `needs: z.enum(TRANSACTION_NEEDS).optional()` on both GETs;
`POST /budgets/{budget_id}/transactions/approve` and `/reject` (body `TransactionIdsRequest`, 200
`TransactionsResponse`, the file's errors, through `refusals`).

`routes/bank-connections.ts`: `POST /bank-connections/{id}/sync` (`idRequest`, 200 `SyncResultResponse`,
`idErrors`) and `POST /budgets/{budget_id}/sync` (path param `budget_id`, 200 `PlanSyncResponse`, 404).

## T10. MCP tools and coverage

`mcp/tools/transactions.ts`:
- `list_unapproved_transactions` `{ budget_id, account_id? }` → the list with `needs`. Returns `{
  transactions, balances }`; says it lists unapproved rows and rows that need a category.
- `approve_transactions` `{ budget_id, ids }` → `{ transactions }`; says split lines and a transfer's
  other side follow.
- `reject_transactions` `{ budget_id, ids }` → `{ transactions }` as they were; says reject only works on
  unapproved imports, an approved one is a tool error, and a rejected import never comes back.
- `update_transaction` description adds: "Saving a change to an unapproved transaction approves it (unless
  approved: false is sent)". `list_transactions` / `get_transaction` descriptions name the five new fields.
- Every description uses `MONEY`, `dates("date")`, `timestamps(["updated_at","created_at"])`.

`mcp/tools/bank-connections.ts`: `sync_bank_connections` `{ budget_id, bank_connection_id? }`; with an id →
the `SyncResult`, without → `{ results }`. Description: contacts the bank (Plaid) and may add, change and
delete **unapproved** transactions; Plaid's sign is the opposite and is converted (`MONEY`); `status`
values; `has_more`; `timestamps(["last_synced_at"], ["last_synced_at"])`.

`mcp/tools/accounts.ts`: list/get descriptions name `unapproved_count` and `needs_attention_count`.

Coverage: `test/mcp-coverage/transactions.ts` — both GET lines `tool: ["list_transactions",
"list_unapproved_transactions"]`; `"POST /budgets/{budget_id}/transactions/approve": { tool:
"approve_transactions" }`, `…/reject`: `reject_transactions`. `test/mcp-coverage/bank-connections.ts` —
`"POST /bank-connections/{id}/sync"` and `"POST /budgets/{budget_id}/sync"`: `{ tool:
"sync_bank_connections" }`.

`test/mcp-timestamps.test.ts` (each call next to its resource's calls, never at the end; `NOT_CALLED` stays
empty): `list_unapproved_transactions` `{budget_id}` after `list_transactions`; `approve_transactions`
`{budget_id, ids: [c.tx]}` after `update_transaction`; `reject_transactions` `{budget_id, ids:
[c.importTx]}` next to `delete_transaction`, where the seed adds one throwaway hand row `importTx` and marks it
an unapproved import in D1 (`import_id 'zz-imp-1', source 'plaid', approved 0`), as it already writes
`bank_connections` in D1; `sync_bank_connections` `{budget_id, bank_connection_id: c.conn}` after
`rename_bank_connection` (seeded connection, no token: `broken`, no Plaid call).

Verify: `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps`, `openapi` tests pass unedited (except the
three files named).

## T11. Test stand-in and Worker tests

`test/plaid-stub.ts`: `PlaidHandler` may return a Promise; add `plaidTxn(over)` (made-up ids, `ZZ` names),
`syncPages(pages)` → a `/transactions/sync` handler serving page *n* for cursor `c<n-1>` (null/absent →
page 1) with `next_cursor c<n>`, and `plaidError(status, code)`. `test/plaid-sync-helpers.ts` (if useful):
connect + link through REST with `today`, read rows, `failingBatchEnv(n)` (an `env` whose `DB.batch` throws
on its n-th call once).

Tests (names indicative; each Acceptance case is one `it`, named with its label):
`plaid-sync.test.ts` (1–7, 9, 13, 14, 16, 22, 23), `plaid-sync-runs.test.ts` (8, 10, 11, 12, 15, 24, 25,
26), `transactions-approve.test.ts` (17–21, PATCH approval, DELETE tombstone). Case 26 spies on
`console.log/info/warn/error` and reads `select * from change_log` as JSON text. First, check that the
stand-in reaches `runSync` inside the DO (a route sync records a `/transactions/sync` call); if the DO's
`fetch` does not see the spy, say so in the report rather than bypassing the DO in case 12. Every test asserts
`clean()` (no `SENTINEL` value) on responses and change_log text it reads. Each new test file asserts its
paths with `apiPaths()` and tools with `listedToolNames()`. The scheduled case sets `last_synced_at`
relative to `Date.now()` and asserts only its own connections. Direct D1 writes are allowed here (Worker
tests): reconciled state, a closed-but-linked account, `last_synced_at`, `status`.

Verify: `pnpm check` green. Do not run the full e2e suite (final_gate does).

## T12. Docs

`docs/conventions.md`, Product rules, Actor: add "`service:plaid` for the writes of a bank sync". The
`docs/README.md` line is already there. Each step's report says, for itself, that it did not open the source
app, call Plaid or call the live app.
