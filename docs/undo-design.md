# Undo / Redo: design

Plan p_66a8e22e545f480d8c0c4092571b8e09. This file starts with unit U1 (change sets), the shared base for Undo/Redo
in the register (EXF-530), on the Plan page (EXF-504) and in Manage Payees (EXF-510 acc. 10, EXF-882 item 3).
Later units add their sections here or in their own design files.

## Change sets

A **change set** is every `change_log` row one write request produced. Before this, nothing tied a request's rows
together. Rows of one batch can differ in `created_at` by milliseconds (see `categories-design.md`, the delete
batch), so time could not group them.

### The column

- `change_log.change_set_id text`, nullable, with index `change_log_change_set (budget_id, change_set_id)` (migration
  `*_change_sets.sql`; Drizzle `db/schema/change-log.ts`, `changeSetId`).
- Rows written before the migration keep `null`.

### Where the id comes from

- `middleware/change-set.ts` (`changeSet()`) runs after Access and before Idempotency, on `/api/v1/*` and `/mcp`.
  For **POST, PATCH, PUT and DELETE** it makes one `crypto.randomUUID()` and runs the rest of the request inside
  `runInChangeSet(id, …)` (`history/change-set.ts`, an `AsyncLocalStorage`; `nodejs_compat` is on).
- Every statement that inserts a `change_log` row stamps `change_set_id: currentChangeSetId()`:
  - `changeLogInsert` and `changeLogInsertIf` (`history/change-log.ts`);
  - `logSelectStmt` (`repositories/guards.ts`);
  - `reconcileLogsStmt` (`repositories/reconcile.ts`);
  - the payment-group insert in `paymentCreateStmts` (`services/credit-payments.ts`).
- `scripts/test/change-log-stamp.test.ts` scans the worker sources and fails on a `change_log` insert without the
  stamp. Allowed: `livePayeesCheck` (`repositories/payees.ts`). It fails on purpose to abort a batch and never
  commits a row.
- The stamp adds no statement and no D1 call: a mutation stays one `db.batch` with its rows.

### The header

- A 2xx response to a write carries `Budget-Change-Set: <id>`, the same id as the request's rows.
- In the web app, `apiFetch(path, { …, onChangeSet })` (`apps/web/src/api/client.ts`) calls `onChangeSet(id)` when a
  2xx write has the header. It does not call it on an error or without the header.

### What gets one and what does not

| request | change set | header |
|---|---|---|
| REST POST/PATCH/PUT/DELETE under `/api/v1` | yes, one per request | on 2xx |
| MCP POST to `/mcp` (each JSON-RPC request; a `tools/call` that writes stamps its rows) | yes | on 2xx, even when the call wrote nothing |
| GET (REST or MCP) | no | no |
| a write that fails (4xx/5xx) | the id exists while it runs, but the batch wrote nothing | no |
| an Idempotency-Key replay | no new rows | no: only the stored body is replayed (accepted) |
| cron (`scheduled.ts`: enter due, bank sync) | no, `null` | – |
| a bank sync run in the `PlaidItemSync` Durable Object, even one a request started | no, `null`: the request's context does not reach the object | – |
| a service called directly (tests, scripts) | no, `null` | – |

An MCP POST that writes nothing (`initialize`, `tools/list`) still gets a header. Its id owns no rows.

## Decisions (Driver, on the plan)

1. **D1: Undo runs on the server, from change sets.** This replaces the tickets' client-held inverses (EXF-530 `POST …/transactions/batch`,
   EXF-504 `POST …/categories/{cid}/restore`). A client cannot reverse side effects it never sees: a payee created by an
   edit, rename-rule learning, an import-start move, tombstones, a reassignment of N transactions. A blind re-PATCH
   would also overwrite a later sync or MCP edit. One new operation, `POST …/changes/{id}/undo` (U2).
2. **D2: Stack scope.** Pending a look at the source. Recommended: one in-memory stack per plan per tab, shared by
   the registers, the Plan page and Manage Payees, capped at 100; a reload clears it. Does not affect U1.
3. **D3: A stale undo refuses the whole undo.** If an entity changed after the action (a sync, another tab, MCP),
   the undo answers 409 and writes nothing. The client shows why and drops the entry.
4. **D4: MCP gets an `excluded` line** for the undo operation ("browser-session undo; agents call the inverse
   operation").
5. **D5: The plan's recommended undoable list.**
   - Recorded: the tickets' listed actions; star toggle; scheduled create, edit and delete; Auto-Assign runs.
   - Not recorded: reconcile, account close/delete, bank connections, plan import, enter-due-on-open (EXF-658), syncs.
   - Change sets are written for all writes regardless. The list decides only what the client puts on the stack.
6. **D6: Plan page month jump** (undo jumps to the changed month). Pending a look at the source. Recommended yes, as a
   departure. Does not affect U1.
