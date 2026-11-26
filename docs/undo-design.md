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
2. **D2: Stack scope.** Settled (the source confirmed it on 2026-11-24): one in-memory stack pair per plan per tab,
   shared by the registers, the Plan page and Manage Payees, capped at 100; a reload clears it. Manage Payees acts
   only on entries made since it opened (`origin: "payees"`).
3. **D3: A stale undo refuses the whole undo.** If an entity changed after the action (a sync, another tab, MCP),
   the undo answers 409 and writes nothing. The client shows why and drops the entry.
4. **D4: MCP gets an `excluded` line** for the undo operation ("browser-session undo; agents call the inverse
   operation").
5. **D5: The plan's recommended undoable list.**
   - Recorded: the tickets' listed actions; star toggle; scheduled create, edit and delete; Auto-Assign runs.
   - Not recorded: reconcile, account close/delete, bank connections, plan import, enter-due-on-open (EXF-658), syncs.
   - Change sets are written for all writes regardless. The list decides only what the client puts on the stack.
6. **D6: Undo navigates to where the change was made.** Settled (the source confirmed it on 2026-11-24). The undo
   answers `where`; the surfaces navigate.

## Undo engine and store

Unit U2 (EXF-530 and EXF-504, data side). One operation reverses a change set; one web store keeps the stacks. The
buttons, keys and navigation come in later units.

### The operation

`POST /api/v1/budgets/{budget_id}/changes/{change_set_id}/undo` (`routes/changes.ts`, `services/undo.ts`,
`repositories/undo.ts`, schemas in `@budget/schema/changes`). It takes no body and answers `{ data: { change_set_id,
undone_change_set_id, entities, where } }`:
- `change_set_id` is the undo's own set, the same as its `Budget-Change-Set` header.
- `where` is `{surface: "register", account_id, transaction_ids}`, `{surface: "plan", month, category_ids}` or
  `{surface: "payees", payee_ids}` (D6).

MCP has no tool: `excluded` in `test/mcp-coverage/changes.ts` (D4).

**Redo is the undo of the undo's set.** Every set can be undone once. `change_set_undos (budget_id, change_set_id)`
is the record, with `undo_change_set_id`, `actor` and `created_at`. Its primary key stops a second undo, even a
racing one.

**What it writes.** The undo writes one `change_log` row per entity it reverses, under its own set, with the
caller's actor:
- An `update` puts back the earlier values: before = what the set wrote, after = what it restores plus `undo_of: <set
  id>`.
- A created entity is soft-deleted (`delete`, after `{undo_of}`).
- A deleted entity comes back (`create`, after = the restored shape plus `undo_of`; a transaction that had an import
  tombstone also carries `tombstone: {reason}`, so a redo puts the tombstone back).
- Month cells reversed from a move or cover get `after.move = {id, month, from_category_id, to_category_id, amount,
  kind: "undo", undo_of: <original move id>}`, with the sides swapped.

### Net rows

A set may touch an entity more than once. The engine works on one **net row** per `(entity_type, entity_id)`, read
in SQL from `change_log` in `rowid` order:
- the first row's `before`;
- the last row's `after`;
- `create` if the first action was a create, `delete` if the last was a delete, else `update`;
- created-then-deleted entities are skipped.

### Rule table

"Holds" means every mapped key present in the JSON equals the column. Absent keys are neither compared nor written,
so partial rows (category reassign, payee bulk hide) use the same statements.

| entity_type | mapped keys → columns | net create → | net delete → | net update → | refused |
|---|---|---|---|---|---|
| `transaction` (rows and lines) | `account_id, date, payee_id, category_id, inflow_to_ready_to_assign, memo, amount, cleared, approved, import_id, source, imported_payee, import_payee_name, bank_description, flag_color, transfer_account_id, transfer_transaction_id`; `subtransactions` by the line rule. `payee_name` is derived and never compared; it is rewritten when the payee or transfer changes | guard live and holds after; soft-delete the row and its lines; put back a carried tombstone | guard still deleted and holds before; undelete it and its listed lines; delete its import tombstone | guard live and holds after; write before | reconcile rows; bank match/unmatch; a row made live or moved must end in a live open account |
| `payee` | `name, hidden, category_mode, fixed_category_id, fixed_inflow_to_ready_to_assign` | soft-delete; stale if anything live still names it | undelete | write | system payees; a delete that moved transactions or schedules when the set lacks their move rows (sets from before U5) |
| `payee_rename_rule` | `payee_id, kind, text` (+ `match_text` folded) | soft-delete | undelete | write | – |
| `scheduled_transaction` | `account_id, date_first, date_next, frequency, amount, payee_id, category_id, inflow_to_ready_to_assign, memo, flag_color`; `deleted`; `updated_at` as a guard | soft-delete | undelete | write; every write renews `write_token` | – |
| `scheduled_subtransaction` (lines of split schedules that moved on their own: category delete, payee delete or combine) | `amount, payee_id, category_id, inflow_to_ready_to_assign, memo` | soft-delete | undelete | write; the parent's `write_token` renews | a live line whose category or payee is no longer live, while its schedule is live |
| `pending_transaction` (EXF-466) | `date, amount, payee_name, resolved_at` (`resolved_at` is the guard: a sync that posts or removes the item sets it) | – | undelete; `entered_transaction_id` is cleared, so it is an untouched item again; stale once a sync has set `resolved_at` | write | a live item whose account is deleted, closed or no longer linked to a bank account |
| `category` | `group_id, name, sort → sort_order, hidden, note` | soft-delete; stale if anything live still names it | undelete at its `sort_order`; its group must be live | write | payment categories |
| `category_group` | `name, sort → sort_order, hidden, collapsed` | soft-delete; stale if it holds a live category | undelete | write | the payment group |
| `month_category` | `assigned` of the cell `(month, category_id)` | – | – | guard `coalesce(assigned, 0) = after.assigned`; upsert before | – |
| `target` | the definition: `cadence, behavior, amount, day_of_week, day_of_month, due_date, due_month, repeat, created_on` | delete the row | insert it again; its category must be live | write | a key outside the map |
| `account` | `starred` only | – | – | write `starred` | anything but a star toggle |
| `budget`, `bank_connection`, `plaid_credentials`, `view_settings`, `month`, `target_snooze`, others | – | – | – | – | always |

**Line rule.**
- Lines in the set's after but not its before are soft-deleted.
- Lines in its before but not its after come back.
- Lines in both get their keys written.
- Then live lines copy the parent's account, date, cleared and approved.

After the writes, the stored payee defaults of the payees involved are recomputed (`recomputeDefaultsStmt`).

### U5: payee delete moves

`buildPayeeDeleteBatch` logs, before the two moves (`repositories/payee-delete-log.ts`, one `logSelectStmt` each, D1 calls
unchanged): a `transaction` `update` per moved row (parents and split lines), before `{id, payee_id, payee_name}`, after
`{id, payee_id: replacement, payee_name}`; and a `scheduled_transaction` `update` per moved schedule, before/after
`{id, payee_id}` (the table has no payee name). No `account_id`, so `where` stays `{surface: "payees"}`. The refusal
for a payee `delete` now applies only when its after reports moved rows and the set holds no move row for that payee
(sets from before U5). Undo writes the payee, its rules and the rows' `payee_id` back (the name is re-derived); redo
is the undo of that undo. A moved row in a closed account (or a schedule in a deleted one) is still refused by the
post-check. Restoring a deleted rename rule qualifies the column names of its `update … from` (a rule's `kind` clashed with the net's).

### Refusals and staleness (D3)

| status | name | when |
|---|---|---|
| 404 | `not_found` | the plan is not active, or the set has no row in it |
| 403 | `forbidden` | a row's actor is not the caller's (`service:plaid`, `mcp:…`, another user) |
| 409 | `already_undone` | the set was undone before |
| 409 | `undo_refused` | the set holds something the table refuses, or the result would break a service rule (closed or deleted account, deleted category, group or payee) |
| 409 | `undo_stale` | an entity no longer holds what the set wrote, a created entity is now used by a later change, or a restore collides with a live unique row |

A refusal writes nothing, and the client drops the entry.

### One batch, constant calls

An undo makes one read-only batch and then **one** write `db.batch`. Neither grows with the set's rows, because
every statement reads the set from `change_log` itself.

The read batch holds:
- the set's rows;
- the `change_set_undos` row;
- the plan;
- one stale finder per entity type.

The write batch runs:
1. the stale checks;
2. the undo's log rows;
3. restores, parents first;
4. soft-deletes of created entities, children first;
5. the payee-default recompute;
6. the post-checks;
7. the `change_set_undos` record.

A check aborts the batch by inserting a NULL into `change_set_undos`:
- `undo_change_set_id` → `undo_stale`;
- `actor` → `undo_refused`.

Never into `change_log`: the stamp test allows only `livePayeesCheck` there.

### The web store

`apps/web/src/undo/store.ts` (no React), `apps/web/src/undo/useUndo.ts` (the hook), `apps/web/src/api/changes.ts`.
- One `{undo, redo}` pair per plan, in memory: per tab, and a reload clears it. Each stack is capped at 100, and the
  oldest entries drop off.
- `recordChange(budgetId, changeSetId, origin)` pushes onto Undo and clears Redo.
- **Undo** pops the top entry and calls the operation.
  - On success, the undo's own set goes onto Redo, and the store returns `where`.
  - On 409 or 403/404, the entry is dropped: on neither stack, and the error's detail is shown.
  - On a network or 5xx error, the entry goes back.
- **Redo** is the same over Redo. Its result goes onto Undo without clearing Redo.
- One operation runs at a time per plan.
- `undoState(budgetId, scope)` gates the hook. With `{origin: "payees", since: mark()}`, only entries Manage Payees
  recorded since it opened count; any other top entry disables Undo there. Registers and the Plan page pass no
  scope and act on the shared top entry.

### Origins in use

`plan`: Plan page edits, category and group reorders, and the sidebar's account reorder (EXF-490 follow-up; it was
`register`). `register`: register edits. `payees`: Manage Payees. Unscoped consumers (the Plan page, registers) act on
the shared top entry whatever its origin, so the origin matters only to scoped ones.

## Idempotent replays keep their change set (EXF-982)

`idempotency_keys.change_set_id` (nullable) stores the change-set id of the original response. A replay returns it in
`Budget-Change-Set` (with `Idempotent-Replayed: true`), so Undo works after a retry whose first response was lost. A write
that ran outside a change set stores null and replays with no header.
