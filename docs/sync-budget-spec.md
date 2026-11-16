# Sync budget spec (EXF-613)

Tasks for [sync-budget-design.md](sync-budget-design.md). Worker only: **no file under `apps/web/`, no e2e
spec, none of the out-of-bounds files of the brief** (`packages/core/**`, `db/client.ts`, `secrets/**`,
`middleware/**`, `history/**`, `app.ts`, `mcp/server.ts`, `mcp/types.ts`, `env.ts`, `wrangler.jsonc`, the
Plan-page and reports files, every `paths.always_overlap` file). No new dependency, no new binding. Never call
Plaid, the live app or the source; tests use the stand-in and `SENTINEL` values.

## T1. Column, API field, descriptions

- `apps/worker/migrations/20261116100900_sync_failed_at.sql`:
  `ALTER TABLE bank_connections ADD COLUMN sync_failed_at text;` (that name exactly; nothing else).
- `db/schema/bank-connections.ts`: `syncFailedAt: text("sync_failed_at")` (after `syncLoopCursor`).
- `repositories/bank-connections.ts`: add `"syncFailedAt"` to the `Pick` of `updateConnectionStmt`; add
  ```ts
  /** Holds while the connection exists and needs no repair (login_required, broken): a failed run may say so. */
  export function failureMayBeRecorded(db: Db, id: string): SQLWrapper;
  ```
- `services/bank-connections.ts`: `toApi` returns `sync_failed_at: row.syncFailedAt`; the create path's row
  literal gets `syncFailedAt: null`.
- `packages/schema/src/bank-connections.ts`, `BankConnection`:
  `sync_failed_at: z.string().nullable().default(null).openapi({ description: "When the last sync that failed in Budget (not at the bank) ended; null once a sync finishes. Such a sync leaves status delayed and is retried." })`.
  `status` description: `connected, delayed (the bank or Plaid did not answer, or the last sync failed in
  Budget, see sync_failed_at; it is retried), login_required (…), broken (…) or not_set_up` (keep the rest).
  `SyncResult.has_more` describe: `"True when there is more to read (the bank has more, or the run stopped at
  its limit): sync again"`.
- `mcp/tools/bank-connections.ts`: `FIELDS` gains `sync_failed_at` after `last_reset_at`; the three
  `timestamps([...], [...])` calls of `list_bank_connections`, `get_bank_connection`, `rename_bank_connection`
  gain `"sync_failed_at"` in both lists; `sync_bank_connections`: "delayed (the bank did not answer, or the
  sync failed in Budget: try later)" and "has_more true means there is more to read: call again".
- Delete `.e2e-state` after adding the migration.

Verify: `test/schema-drift.test.ts`, `mcp-timestamps.test.ts`, `mcp-descriptions.test.ts`,
`bank-connections*.test.ts` pass.

## T2. Constants (`packages/schema/src/plaid-import.ts`)

```ts
/** Calls (D1 statements or batches, plus Plaid calls) one run may plan for, its final batch included.
 *  Free plan: 50 D1 queries and 50 subrequests per invocation; a db.batch is one query. */
export const RUN_CALL_BUDGET = 45;
/** The counter refuses a call past this; the failure write may still make one more. */
export const RUN_CALL_HARD_LIMIT = 48;
/** Entries per unit: D1 allows 100 bound parameters a statement. */
export const SYNC_UNIT_SIZE = 90;
/** One scheduled invocation: at most this many runs (DO requests), and none started after this time. */
export const SCHEDULED_MAX_RUNS = 40;
export const SCHEDULED_WALL_MS = 10 * 60_000;
```
`MAX_UPDATES_PER_RUN`, `MAX_PAGES_PER_RUN`, `DUE_AFTER_MS` stay.

## T3. The counter: new `apps/worker/src/services/sync-budget.ts`

```ts
export class CallLimitReached extends Error {}      // message "call limit reached"; no ids, no secrets
export class SyncBudgetTooSmall extends Error {}    // message "sync budget too small"
export class CallBudget {
  constructor(limit?: number /* RUN_CALL_BUDGET */, hard?: number /* RUN_CALL_HARD_LIMIT */);
  d1: number; plaid: number;
  get used(): number;                    // d1 + plaid
  /** True when `calls` more calls still leave one for the final batch. */
  fits(calls: number): boolean;          // used + calls + 1 <= limit
  /** Room for batches after `reads` more reads and the final batch. */
  batchesLeft(reads?: number): number;   // limit - used - reads - 1
  failing(): void;                       // allows one call past `hard` (the failure write)
  charge(kind: "d1" | "plaid"): void;    // throws CallLimitReached when used >= hard (hard + 1 once failing)
}
export function countedEnv(env: Env, b: CallBudget): Env;          // { ...env, DB: counted(env.DB) }
export function countedPlaid(p: PlaidClient, b: CallBudget): PlaidClient;  // { environment, post: charge then p.post }
```
The D1 wrapper:
- `prepare(sql)` returns the binding's **own** statement object with own-property overrides: `bind(...)`
  re-wraps its result the same way; `all`, `raw`, `first` and `run` call `charge("d1")` and then the
  original. No `Proxy` on statements, so `batch` receives real statements.
- `batch` and `exec` call `charge("d1")` once.
- `dump` and `withSession`, if present, pass through.
- Never logs.

Verify with a unit test (in `plaid-sync-budget.test.ts`):
- a select, an insert and a 3-statement `db.batch` through `getDb(countedEnv(env, b))` give `b.d1 === 3`;
- `charge` past `hard` throws;
- after `failing()`, one more call passes.

## T4. Batch packing (`services/batch-groups.ts`)

```ts
/** The number of batches `runGroups(db, groups, max)` would make for groups of these sizes (a group alone may exceed max). */
export function batchCount(sizes: readonly number[], max?: number /* STATEMENTS_PER_BATCH */): number;
```
It mirrors `runGroups`' packing exactly: empty groups add nothing, and a group is flushed before it would
overflow. `runGroups` does not change. Verify with a unit test: `[45,45,1]` gives 2; `[100]` gives 1;
`[]` gives 0; `[89,2,89]` gives 3.

## T5. Read builders (same SQL, now batchable)

- `repositories/accounts.ts`: export `startingBalanceDateQuery(db, accountId)` and
  `latestReconciledDateQuery(db, accountId)`. Each is the unawaited select that the existing function uses
  today. The existing `startingBalanceDate` and `latestReconciledDate` become `(await …Query(…))[0]?.d ?? null`,
  and their callers stay as they are. `countsInBalance()` is untouched.
- `repositories/transactions.ts`: `listLines` filter gains `parentIds?: readonly string[]`, giving
  `inArray(parentTransactionId, parentIds)`; an empty list returns `[]` without a query. The callers pass at
  most 90.
- `repositories/imports.ts` (keep every existing export):
  ```ts
  /** The ids among `budgetIds` of plans that are not deleted. One query. */
  export async function livePlanIds(db, budgetIds: readonly string[]): Promise<Set<string>>;
  /** Unawaited selects for db.batch: */
  export function tombstonesQuery(db, budgetId, ids: readonly string[]);     // ≤ 90 ids, as tombstonedIds
  export function rowsByImportIdQuery(db, budgetId, ids: readonly string[]); // ≤ 90 ids, as rowsByImportId
  export function matchCandidatesQuery(db, accountId, from, to);             // as matchCandidates (map rows with toCandidate)
  export function liveDateAmountsQuery(db, accountId, from, to);             // as liveDateAmounts
  export function categoryNamesQuery(db, budgetId);  // { id, name, groupName, deleted } for every category of the plan, deleted ones included; group by left join, deleted or not
  export const toCandidate: (row: TransactionRow) => MatchCandidate;
  export type CategoryNames = Map<string, { name: string; groupName: string | null; deleted: boolean }>;
  ```
  `deleted` is true when either the category or its group is deleted. That matches
  `categoriesRepo.findActive`, which joins only live groups. `matchCandidates`, `tombstonedIds`,
  `rowsByImportId` and `liveDateAmounts` keep their signatures and call the builders.

Names, in `plaid-sync.ts`:
```ts
const forNewRow = (n: CategoryNames, id: string | null) => // = namesOf(): active only
  id && n.get(id) && !n.get(id)!.deleted ? { categoryName: n.get(id)!.name, groupName: n.get(id)!.groupName } : { categoryName: null, groupName: null };
const forExisting = (n: CategoryNames, id: string | null) => // = findDetail()'s left joins
  id && n.get(id) ? { categoryName: n.get(id)!.name, groupName: n.get(id)!.groupName } : { categoryName: null, groupName: null };
```

## T6. `runSync` (`services/plaid-sync.ts`)

Signature: `runSync(env, connectionId, opts: { maxUpdates?; maxPages?; callBudget?: number } = {})`.
`requestSync`, `syncBankConnection`, `syncPlan` and the DO do not change.

1. `const budget = new CallBudget(opts.callBudget ?? RUN_CALL_BUDGET)`; `const cenv = countedEnv(env,
   budget)`; `const db = getDb(cenv)`. **Every** D1 and Plaid call of the run goes through `cenv`, `db` or
   `countedPlaid(plaid, budget)`, including `getAccessToken(cenv, …)`, `plaidFor(cenv, …)` and the final batch.
2. `findById`: NotFound throws, as today, with no failure write. Then
   `try { return await syncConnection(...) } catch (e) { await recordFailure(...).catch(() => {}); throw e; }`.
   The early returns (`NEEDS_REPAIR`, `broken` from a missing token, `not_set_up`, a bank error stored by
   `storeStatus`) are not errors and stay as they are.
3. **Links:** `linkedToConnection`, then `livePlanIds` once, in place of the `findActive` loop. Same
   `linked` / `open` / `links` / `fresh` / cursors.
4. **Plaid:** `fetchSyncPages(countedPlaid(plaid, budget), …)` and `fetchBalances(…)`, unchanged otherwise.
5. **Context.**
   - `netChanges` and the sort as today. For each open account, take `mine` (its entries) and its own
     `lo`/`hi`. The plans are those of the accounts with entries.
   - `planPayees` for each of those plans, as today.
   - Then **one** `db.batch([...])` holding:
     - for each account with entries: `startingBalanceDateQuery`, `latestReconciledDateQuery`,
       `matchCandidatesQuery(lo − 10 d, hi + 10 d)`, and `liveDateAmountsQuery(lo, hi)` when in recovery;
     - for each plan: `categoryNamesQuery`.
   - Skip the batch when no account has entries.
   - Keep a per-account `used` set.
6. **Units.** For each open account, in today's order, cut its `mine` into units of `SYNC_UNIT_SIZE`. For
   each unit:
   - a. If `!budget.fits(3)` (1 read batch + 1 lines read + 1 write batch) → stop.
   - b. `db.batch([tombstonesQuery(ids), rowsByImportIdQuery(ids)])` gives the tombstones and `existing`.
   - c. Decide each entry **as today**. In order:
     - a `followBank` decision (no reads: build `set` and the plan);
     - `skipReason` → `skipped++`;
     - `pickMatch` (mark `used`);
     - the recovery duplicate;
     - the insert.
   - d. Lines: collect the parent ids that need lines (picked candidates, and existing rows with a non-empty
     `set`). One `txRepo.listLines(db, budgetId, { parentIds })` gives the map. Then build the groups exactly
     as today:
     - the match: `forExisting` names, `logShape({...c, ...names}, lines)`, `syncLinesIfStmt` when there are
       lines;
     - `followBank`: `forExisting`;
     - the insert: `forNewRow` in place of `namesOf`.

     Make `followBank` take the names map and the lines instead of reading them.
   - e. Write: let `k` be the largest prefix of the unit's groups for which
     `batchCount(sizes(groups[0..k])) <= budget.batchesLeft()`. Run `runGroups(db, groups[0..k])`, and add
     the counts (by kind, `changes > 0`) as today.
     - `k < groups.length` → stop.

   A run that stops (at a or e) **without having written any group** throws `SyncBudgetTooSmall`. The next run
   would stop at the same place, so the run is recorded as failed (step 10).
7. **Removed** (after all units; skipped when stopped). For each plan, in slices of 90 ids:
   - `fits(1)` → `rowsByImportId`.
   - For each row with `removedPlan === "delete"`: `fits(2)` → `findDetail` + `listLines`, then build the
     group as today.
   - Write the slice's groups with the same prefix rule as 6e.
8. **Stop** means: no further reads or writes for entries, then the final batch with `stopped = true`.
9. **Final batch** (guard `cursorIs(row.syncCursor)`, `runGroups(db, [final], MAX_SAFE_INTEGER)`).
   - Not stopped: as today, plus `syncFailedAt: null`.
   - Stopped: `updateConnectionStmt({ lastSyncedAt, status: "connected", syncFailedAt: null, updatedAt })`
     only: **no** `syncCursor`, `syncLoopCursor`, `syncAccounts` or `syncErrorSince`.
   - Balances and the `row.status !== "connected"` change_log row as today. `after` uses
     `syncFailedAt: null`.
   - Zero changes on the last statement → `throw new Error("sync conflict")`, as today.
   - Result: `has_more: stopped || (pages?.hasMore ?? false)`.
10. **`recordFailure(db, row, bankAccounts, budget)`:**
    - `budget.failing()`;
    - `now = new Date().toISOString()`;
    - one `db.batch`, each statement guarded by `failureMayBeRecorded(db, row.id)`:
      - `changeLogInsertIf({ budgetId: null, actor: PLAID_ACTOR, action: "update", entityType: "bank_connection", entityId: row.id, before: toApi(row, accounts), after: toApi({ ...row, status: "delayed", syncFailedAt: now, updatedAt: now }, accounts) })`;
      - `updateConnectionStmt(db, row.id, { status: "delayed", syncFailedAt: now, updatedAt: now })`.
    - No cursor, no `syncErrorSince`, no log line. The DO's existing `console.error` with the id stays the
      only log.

Verify: Acceptance cases 1–6 and 9 of the design, and every existing sync test (see T8).

## T7. Scheduled round-robin (`syncDueConnections`, same file)

```ts
export async function syncDueConnections(env: Env, now = new Date(), run = requestSync): Promise<SyncResult[]>;
```
- `due = listDue(...)`, as today. `active = due`, `runs = 0`, `started = Date.now()`.
- For `round = 0 .. MAX_RUNS_PER_CONNECTION - 1`, and for each `conn` of `active` in order:
  - stop when `runs >= SCHEDULED_MAX_RUNS` or `Date.now() - started >= SCHEDULED_WALL_MS`;
  - `runs++`;
  - `try { r = await run(env, conn); out.push(r); if (!r.has_more) drop conn }`;
  - `catch { console.error(\`sync failed for connection ${conn.id}\`); drop conn }`.
- The next round takes the connections not dropped. Stop early when none are left.
- `run` is a parameter for the unit test only; `scheduled.ts` calls it as today.

Verify: design case 7. The 462-8 and 462-24 schedule tests pass unchanged.

## T8. Tests

`apps/worker/test/plaid-sync-helpers.ts`:
```ts
/** An env whose DB counts calls (statement executions; a batch or exec is one), with the counts. */
export function countingEnv(base?: Env): { env: Env; calls: { d1: number }; reset(): void };
/** Seeds, by SQL, a payee per name with one categorised hand row dated 2026-01-05 (payee history). */
export async function seedPayeeHistory(plan: string, account: string, names: string[], categoryId: string): Promise<void>;
/** Runs runSync until has_more is false (at most `max`), returning each result. */
export async function runUntilDone(e: Env, conn: string, opts?: Parameters<typeof runSync>[2], max?: number): Promise<SyncResult[]>;
```
`countingEnv` is a test-owned `Proxy`, written independently of `sync-budget.ts`, and shaped like the
existing `failingBatchEnv`. To count Plaid calls, diff the stand-in's `calls` before and after each run.

New `apps/worker/test/plaid-sync-budget.test.ts`, one `it` for each design case, named with its label:
- `EXF-613 1: 500 entries with payee history import over several runs, each once`
- `EXF-613 2: every run of that import stays within 45 calls` (literal `45`)
- `EXF-613 3: a run stopped by the budget keeps its cursors and the next run goes on`, plus its variant
  (the 3rd batch throws)
- `EXF-613 4: a thrown error leaves delayed and sync_failed_at, and the old cursor`, plus the conflict and
  `login_required` variants
- `EXF-613 6: a mutation restart after a stop begins at the loop's first cursor`
- `EXF-613 7: the schedule runs three due connections round-robin within its caps`, plus the round-robin unit
  test with a stubbed `run`
- unit tests for T3 and T4

Every case asserts `clean()` on the responses and `change_log` text it reads.

**The counting test against `9e77748`**, in a scratch worktree outside the repository (never a detached HEAD
in the Thread's checkout):
```
git worktree add /workspace/scratch/exf613-base 9e77748
```
Then copy in the new test file and the helpers, run that one file there, and remove the worktree. Case 2
must fail there (report the count of run 1) and pass on the branch (report each run's count). Case 2 may
not import a symbol that is new in this Build.

Existing tests:
- `plaid-sync.test.ts`, `plaid-sync-runs.test.ts`, `transactions-approve.test.ts`, `bank-connections*.test.ts`
  and `mcp-*.test.ts` must pass **unchanged**.
- The only allowed edits are in **462-15** and the two **462-24** cases. Make one only if the run fixes
  differ, and then only replace a single-run expectation with `runUntilDone` and totals. Name each edit in
  the report.
- No test is skipped.
- `mcp-timestamps.test.ts` needs no new call: no new tool.

Verify: `pnpm check` green. Do not run the full e2e suite (final_gate does).

## T9. Docs

The design and spec are committed with the plan, together with the `docs/README.md` line and one "EXF-613"
section each in `plaid-import-design.md` and `plaid-import-spec.md`. If the build ends up different, update
those sections; do not rewrite them. Each step's report says, for itself, that it did not open the source
app, did not call Plaid and did not call the live app.

## Report (Implementer)

- The measured calls per run of case 2, on `9e77748` and now (D1 and Plaid separately).
- The runs that case 1 took.
- Any edit to 462-15 or 462-24.
- `git diff --stat 9e77748`, showing nothing under `apps/web/` and no out-of-bounds file.
