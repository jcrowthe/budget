# Import hardening: the reconciliation payee through export and import, and named columns: design (EXF-723, EXF-725)

**EXF-723:** the export names a reconciliation adjustment's payee "Manual Balance Adjustment" and the import makes
"Reconciliation Balance Adjustment" an ordinary payee. **EXF-725:** statements that write rows by column position
break when a table gains a column. **Worker and schema only: no screen, no file
under `apps/web/` or `e2e/`, no migration, no new REST operation or tool.** Tasks: [import-hardening-spec.md](import-hardening-spec.md).

## The source app in this Build

**Nobody opens, reads or captures anything in the source app, and no file is ever taken from it.** Reasons: this Build changes no screen, so there is nothing to compare; the source app is the owner's real account, and an export from it holds the owner's money. The Designer answers that this Build has no interface. The Tester tests through `pnpm check`, the named Worker and schema tests and, where a real call helps, the local dev Worker by curl. The platform's source check only needs the Clerk's tab to exist; a passing check is not a reason to look. Every test file is written by hand from the text of EXF-476 and EXF-477, or produced by the clone's own export in a test. **Each step states in its report, for itself only, that it opened nothing in the source app and used no file from it.**

## Source

Not studied (section above). No study folder, no screenshot. The reference is the text of EXF-476/477 and the
clone's own export ([plan-export-design.md](plan-export-design.md), [plan-import-design.md](plan-import-design.md)).
This Architect step opened nothing in the source app and used no file from it.

## The Lead's scope notes (copied word for word)

1. **EXF-723, the export:** each system payee is written under its own name ("Starting Balance", "Manual Balance Adjustment", "Reconciliation Balance Adjustment"). There is no fallback that turns one system payee into another: the mapping is exhaustive over the system values, so that a fourth one fails the type check or a test until the export knows it. Split lines and transfers keep their present names. **The export's D1 calls stay 16** (the counting test passes unchanged).
2. **EXF-723, the import:** "Reconciliation Balance Adjustment" maps to the plan's `reconciliation_adjustment` system payee, one per plan, the same row a later Reconcile in the imported plan then uses (read how Reconcile finds or creates it in `apps/worker/src/repositories/reconcile.ts` and `services/reconcile.ts`, and prove with a test that a reconcile with an adjustment after an import creates no second payee of that kind). **At most 3 D1 calls and 2 R2 calls per invocation, as today** (the counting test passes unchanged).
3. **The round trip:** the round-trip test's plan gains a reconciled account with an adjustment row. Export, import, export: identical Plan and Register files, and the imported row's payee is the reconciliation system payee. A hand-written file in the source's style with such a row imports the same way. **The test for point 1 is run once against the present export and its failing line quoted.**
4. **EXF-725, named columns:** every statement that writes rows names its target columns. In `accounts.ts` the two inserts name them. In the import, each `SPEC` entry pairs a column with its value and the insert is built from the names; a column the list does not name takes its default. **Take the names from the Drizzle tables, do not type column lists by hand twice.** If Drizzle's `insert(...).select(...)` cannot take a subset of columns, build the statement with `sql` and say so in the design. One test per table the import writes: every name in `SPEC` exists in the Drizzle table, and every column that is `notNull` without a default is named.
5. **The proof for point 4:** a Worker test adds a throwaway nullable column to `accounts` in its own test database (`ALTER TABLE accounts ADD COLUMN ...`), then creates an account through REST and runs a plan import: both succeed. **Run it once against the present code and quote the failing line** (the present code must fail it; if it does not, say why and what the test then proves).
6. **Search the Worker for every other statement of this kind** (an `insert ... select` or `values` without a column list, a raw `insert into` whose values rely on order) and list each in the design with its file and line; fix those found, or say why one is safe.
7. **`docs/conventions.md` gains one rule:** no statement depends on a table's column order; every insert or copy names its columns. **`docs/plan-import-design.md` gains a short section on what the file format cannot carry**, so that nobody takes it for a fault: an account's `last_reconciled_at` and a closed account's state do not come back through an export and an import (both were seen on the live app).
8. **A finished import's session row** stays for ever today: its DELETE answers 409 `import_finished` and it has no read. Decide in the design what happens to such rows (for example: the existing 24-hour sweep also removes rows of finished imports older than 24 hours; they hold no file). Build it only if it is small and adds no D1 call to an import; otherwise record it as a known issue.
9. **Out of bounds:** everything under `apps/web/` and `e2e/`; every file in the profile's `paths.always_overlap`; the tests the conventions say are never edited; every shared module of the profile (`packages/core/src/**`, `packages/schema/src/common/**`, `apps/worker/src/app.ts`, `middleware/**`, `secrets/**`, `db/client.ts`, `history/**`, `mcp/server.ts`, `mcp/types.ts`); `apps/worker/src/services/reconcile.ts` and `repositories/reconcile.ts` (read them; if point 2 truly needs a change there, name the line and the reason in the design first); the months, month-categories and auto-assign files and anything named `category-activity` (another Build is working there now, with new lines in `apps/worker/test/mcp-timestamps.test.ts`, `apps/worker/test/mcp-coverage/months.ts` and `docs/README.md`: at a rebase keep every line of both sides). No migration. No new REST operation or tool is expected; if the design adds one, it gets its tool, coverage line and timestamps entry as the conventions say.

## Calls that must not change (copied from the brief)

- **The export's D1 calls stay 16** (the counting test passes unchanged): `plan-export-calls.test.ts` (`CALLS = 16`).
- **At most 3 D1 calls and 2 R2 calls per invocation, as today** (the counting test passes unchanged):
  `plan-import-calls.test.ts`.
- Reconcile (not changed here) stays 6 calls without an adjustment and 7 with one (`reconcile-calls.test.ts`).

## Approach

### A. One table of system payee names (points 1, 2)

`SYSTEM_PAYEE_NAMES: Record<PayeeSystem, string>` in `packages/schema/src/plan-export.ts` (not in `payees.ts`:
`transactions.ts` imports `payees.ts`, and `payees.ts` importing `reconcile.ts`/`accounts.ts` would close a cycle):
`starting_balance` → `REGISTER_STARTING_PAYEE`, `manual_adjustment` → `MANUAL_ADJUSTMENT_PAYEE`,
`reconciliation_adjustment` → `RECONCILE_ADJUSTMENT_PAYEE` (the existing constants of `register.ts`, `accounts.ts`,
`reconcile.ts`). Being a `Record` over the enum, a fourth value of `PAYEE_SYSTEMS` fails `pnpm -r typecheck` here; a
schema test also checks at run time that its keys equal `PAYEE_SYSTEMS` and its names are distinct.

- **Export** (`services/plan-export.ts`, the payee of a row, now lines 97–103): transfer → as today; else
  `r.payeeSystem ? SYSTEM_PAYEE_NAMES[r.payeeSystem] : (r.payeeName ?? "")`. No other branch. Split lines (`l.payeeName`,
  or the transfer text) and schedules (`s.payeeName`) unchanged. No new read: **16 D1 calls**.
- **Import** (`packages/schema/src/plan-import.ts`, `payeeOf`): the system value is the inverse of
  `SYSTEM_PAYEE_NAMES` (a `Map` built once), so "Reconciliation Balance Adjustment" → `reconciliation_adjustment`.
  `ImportPlan.payees[].system` widens to `PayeeSystem | null`. The local `STARTING_BALANCE`/`MANUAL_ADJUSTMENT`
  constants are replaced by the table (the Starting Balance detection at line 574 uses
  `SYSTEM_PAYEE_NAMES.starting_balance`). Payees are keyed by their text, so one payee per plan per name; the payee
  row's `name` is the file text, equal to `RECONCILE_ADJUSTMENT_PAYEE`. The partial unique index
  `payees_budget_system` (one live system payee per kind per plan) holds.
- **A later Reconcile** finds the payee with `payeesRepo.findSystem(db, budgetId, "reconciliation_adjustment")`
  (`services/reconcile.ts:93`), creates one only when none exists (`systemPayee`, `insertSystemIfMissingStmt`), and the
  adjustment's `payee_id` comes from `systemIdSql(budgetId, "reconciliation_adjustment")` (`:139`). The imported row
  has exactly that `system`, so **nothing in `services/reconcile.ts` or `repositories/reconcile.ts` changes**.
- Comparison (`plan-import-compare.ts`) treats only `starting_balance` specially: unchanged.

### B. Named columns (points 4, 5, 6)

**Drizzle cannot do it.** `buildInsertQuery` in drizzle-orm 0.45 (`sqlite-core/dialect.js`, lines 336–356) always
emits the column list of **every** column of the table and appends the select as given; a query-builder select must
match all columns in order. So `db.insert(t).select(sql\`select …\`)` is positional over the Drizzle table. That is the
real fault: a column added to the Drizzle table (with its migration) grows the column list while the hand-written
select keeps its old length (`13 values for 14 columns`).

**Also not `db.run(sql)`:** in Drizzle 0.45's D1 `batch`, a statement with parameters is bound through
`preparedQuery.stmt`, which `SQLiteRaw` (what `db.run` returns) does not have.

**Decision:** one helper, `insertSelect(db, table, values, tail?)` in a new `apps/worker/src/repositories/insert-select.ts`.
`values` is an object keyed by the Drizzle table's **property names** (type-checked against `InferInsertModel<T>`,
so an unknown name fails the type check). It builds a throwaway Drizzle table with the same SQL name and only the
named columns (`sqliteTable(getTableName(t), { [key]: text(column.name) })`, names read from `getTableColumns(t)`)
and returns `db.insert(sub).select(sql\`select v1, v2, … ${tail}\`)`: SQL
`insert into "t" ("a", "b", …) select ?, ?, … <tail>`. It stays a Drizzle insert, so it goes in `db.batch` and its
result has `meta.changes` as today. A value that is `SQL` is inlined, anything else is a bound parameter;
`undefined` throws. Columns not named take their SQL default. Verified in a spike (Node, drizzle 0.45): the output is
exactly `insert into "accounts" ("id", "budget_id", "starred") select ?, ?, ? where exists (select 1)`.

**The import.** Each `SPEC` entry becomes `{ table, json, cols }` where `cols` maps a Drizzle property to a JSON index,
`"b"` (the plan's id) or `lit(...)`; `insertRowsStmts` calls `insertSelect` with
`tail = from json_each(?) j where <guard>`. Entries that were `lit("null")` for a nullable column are dropped (no
column of the seven tables has a non-null SQL default on a nullable column: checked in the migrations). Explicit
literals that differ from, or merely repeat, a default stay named (`approved` 1, `frequency` `'never'`, `starred`,
`closed`, `hidden`, `collapsed` 0). `IMPORT_COLUMNS` (the JSON order) keeps its shape. An exported
`importColumnNames(t)` gives the SQL names for the tests.

**The two account inserts** and every other in-bounds positional insert-select use the helper (list below).

**Why the throwaway column must be on both sides (point 5).** A column added only to the database
(`ALTER TABLE accounts ADD COLUMN zz_probe TEXT`) does **not** break the present code: Drizzle names its own 14
columns and SQLite leaves the 15th null. The present code passes that half; it proves only that a database-only
column is harmless. The test therefore also adds the probe to the Drizzle `accounts` object at run time
(`text("zz_probe").build(accounts)` set in `accounts[Table.Symbol.Columns]` and as a property; verified in the
spike to change Drizzle's column list, and removed in `afterAll`), which is what a real migration plus table edit
does. With both, the present code answers 500 on account create and on import; with the fix both succeed.

### C. Finished import rows (point 8)

**Built:** call 1's batch (single-call path and stepped path) gains one statement,
`delete from plan_imports where state in ('done','abandoned') and r2_key is null and updated_at < <now − 24 h>`
(`repo.purgeEndedStmt`). It rides in a batch that already exists: **no D1 call added** (call 1 stays ≤ 3, R2 ≤ 2).
Abandoned rows are included: they too stay for ever today, hold no file and answer only 409. A `done` row whose R2
key is still set is left to the sweep (it clears the key; the next call 1 then purges it). A `writing` row is never
matched. After the purge, continue and cancel on that id answer **404 `not_found`** ("Import not found"), already a
documented answer of both operations; the plan itself and its history entry (which names the `import_id`) stay.

## Point 6: every insert in `apps/worker/src` (36 `.insert(` calls)

**`.values({...})` (14): safe.** Drizzle names every column of its table and fills omitted ones with their default:
`history/change-log.ts:31`, `middleware/idempotency.ts:51`, `repositories/bank-connections.ts:50`, `:54`,
`budgets.ts:22`, `months.ts:22`, `payees.ts:89`, `plan-import.ts:228`, `:232`, `report-settings.ts:20`,
`scheduled-transactions.ts:118`, `transactions.ts:47`, `ui-state.ts:14`, `secrets/index.ts:37`.

**`insert(t).select(sql…)` positional (22).** Fixed with `insertSelect` (18), lines as on `d005439`:

| File:line | Function |
|---|---|
| `repositories/accounts.ts:47`, `:130` | `insertIfSortStmt`, `insertIfStmt` |
| `repositories/plan-import.ts:218` | `insertRowsStmts` |
| `repositories/category-groups.ts:59`, `:104` | `insertIfSortStmt`, `insertIfStmt` |
| `repositories/categories.ts:65`, `:109` | `insertIfSortStmt`, `insertIfStmt` |
| `repositories/payees.ts:96`, `:106`, `:131` | `insertIfStmt`, `insertSystemIfMissingStmt`, `insertByNameIfMissingStmt` |
| `repositories/transactions.ts:55` | `insertIfStmt` |
| `repositories/guards.ts:50` | `logSelectStmt` (change_log) |
| `repositories/imports.ts:126` | `tombstoneIfStmt` |
| `repositories/targets.ts:71` | `upsertIfHoldsStmt` |
| `repositories/target-snoozes.ts:40` | `insertIfStmt` |
| `services/credit-payments.ts:70`, `:75`, `:84` | `paymentCreateStmts` (group, its log, category) |

**Not fixed here (4), each out of bounds (point 9); a follow-up for the Lead:** `history/change-log.ts:41`
(`changeLogInsertIf`, shared module `history/**`); `repositories/reconcile.ts:25` (`reconcileLogsStmt`);
`repositories/month-categories.ts:78`, `:120` (`setIfHoldsStmt`, `mergeIntoStmt`; another Build works there). Each
stays positional over its Drizzle table: `change_log` and `month_categories` must not gain a column before they are
converted. **Raw SQL:** no `insert into` text in `apps/worker/src`; the four `INSERT INTO … SELECT` of the
migrations name their columns. A repository test (`scripts/test/positional-inserts.test.ts`) fails on any new
`.insert(...)` directly followed by `.select(` in `apps/worker/src`, with exactly those three files allowed.

## What changes, downstream, out of scope

- **Behaviour:** an exported reconciliation adjustment reads "Reconciliation Balance Adjustment"; such a row imports
  onto the plan's `reconciliation_adjustment` payee; import session rows go 24 h after they end. Every converted
  insert writes the same values as before (defaults only where null was written).
- **Docs:** `conventions.md`, rule of point 7 under "Statements: name the columns"; `plan-import-design.md`: Payees
  bullet, Leftovers (purge), "What the file format cannot carry"; `plan-export-design.md`: Payee bullet (120–122).
- None of the other Build's files is touched; at a rebase keep every line of both sides in `docs/README.md` and
  `docs/conventions.md`. Out of scope: the reports' text on adjustments (`mcp/tools/reports.ts`), the four statements
  above, a read for an import session, closure or `last_reconciled_at` in the file format.

## Acceptance

All Worker, schema or repository tests, plus `pnpm check`; nothing is compared with the source. **S** = EXF-476's
hand-written sample (`sampleFiles`/`sampleZip` of `plan-import-helpers.ts`); **F** = `buildF`; clock pinned
(`pinPlanClock`) where dates matter.

1. **Export name (point 1).** F plus Main Checking reconciled through REST with an adjustment of −5.00 (statement
   = cleared − 5000, `create_adjustment: true`, `today` 2026-11-16) → the export's Register holds a row
   `"Main Checking","","11/16/2026","Reconciliation Balance Adjustment","Inflow: Ready to Assign",…,$5.00,$0.00,"Reconciled"`.
   Run once against `d005439`: fails (the row reads "Manual Balance Adjustment"); the report quotes the line.
2. **Exhaustive (point 1).** Schema test: `Object.keys(SYSTEM_PAYEE_NAMES)` sorted equals `[...PAYEE_SYSTEMS]` sorted;
   the three names are distinct and equal the three constants. `services/plan-export.ts` holds no string literal
   "Manual Balance Adjustment" or "Starting Balance".
3. **Round trip (point 3).** The plan of case 1 exported (`now=2026-11-16T09:05`), imported (201), exported again:
   Plan entry and Register entry byte-identical. In D1 the imported row's `payee_id` is the id of the new plan's
   only payee with `system = 'reconciliation_adjustment'`, named "Reconciliation Balance Adjustment".
4. **Hand-written (point 3).** A hand-written `.csv` pair in the style of S (memo text built from parts) with two
   "Reconciliation Balance Adjustment" rows in two accounts → 201; one payee `reconciliation_adjustment` in the plan,
   both rows on it, no ordinary payee of that name. Schema unit: `buildImportPlan` gives that payee
   `system: "reconciliation_adjustment"`.
5. **Reconcile after import (point 2).** On the plan of case 4, reconcile an account with a non-zero difference and
   `create_adjustment: true` → 200; still exactly one payee with that system in the plan; the new adjustment's
   `payee_id` is the imported payee's id.
6. **Counts.** `plan-export-calls.test.ts` (16) and `plan-import-calls.test.ts` (≤ 3 D1, ≤ 2 R2) pass with no edit
   to either file; `git diff main -- <both>` is empty.
7. **SPEC per table (point 4).** One test per table of the seven: every name of `importColumnNames(t)` is a column of
   the Drizzle table; every Drizzle column with `notNull` and no default is named; every column of
   `pragma table_info(<t>)` with `notnull = 1`, `dflt_value` null is named. A failure message names table and column.
8. **Throwaway column (point 5).** With `zz_probe` added to the database and to the Drizzle `accounts` object:
   `POST /budgets/{id}/accounts` (checking, and creditCard) → 201; `POST /budgets/import` with S → 201, and the new
   plan's accounts have `zz_probe` null; `POST /budgets/{id}/accounts/{id}/reconcile` → 200. Run once against
   `d005439`: account create answers 500; the report quotes the failing line. The database-only half passes on both
   (B above says why).
9. **Helper.** `insertSelect(...).toSQL()` of a three-key object gives exactly
   `insert into "accounts" ("id", "budget_id", "starred") select ?, ?, ? <tail>`; an `undefined` value throws.
10. **Guard (point 6).** `scripts/test/positional-inserts.test.ts` passes; adding a `db.insert(x).select(sql\`…\`)` to
    any other file of `apps/worker/src` makes it fail naming the file.
11. **Purge (point 8).** Rows inserted by SQL: A `done` 25 h old, no key; B `abandoned` 25 h; C `done` 23 h; D
    `writing` updated 1 h ago. POST S (201) → A and B gone; C and D unchanged; continue on A → 404. The S import's own
    row exists. Same through the stepped path (`chunkRows` 7).
12. **Whole suite.** `pnpm check` passes; every existing export, import, account, category, payee, transaction,
    target, bank-sync and reconcile test passes unedited (none of `openapi.test.ts`, `mcp.test.ts`, `e2e/mcp.spec.ts`
    changes).

## Manifest

touches: [docs/import-hardening-design.md, docs/import-hardening-spec.md, docs/plan-import-design.md, docs/plan-export-design.md, docs/conventions.md, docs/README.md, packages/schema/src/plan-export.ts, packages/schema/src/plan-import.ts, packages/schema/test/plan-export.test.ts, packages/schema/test/plan-import.test.ts, apps/worker/src/repositories/insert-select.ts, apps/worker/src/repositories/plan-import.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/category-groups.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/guards.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/repositories/targets.ts, apps/worker/src/repositories/target-snoozes.ts, apps/worker/src/services/credit-payments.ts, apps/worker/src/services/plan-export.ts, apps/worker/src/services/plan-import.ts, apps/worker/test/plan-import-roundtrip.test.ts, apps/worker/test/plan-import-reconcile.test.ts, apps/worker/test/plan-import-columns.test.ts, apps/worker/test/named-columns.test.ts, apps/worker/test/plan-import-purge.test.ts, scripts/test/positional-inserts.test.ts]
shared: []
migrations: 0

## As built

- `insertSelect` returns Drizzle's insert builder (not `BatchItem`) so `tombstoneIfStmt` can still call `onConflictDoNothing()`.
- The conversions of the 16 in-bounds statements were made from the Drizzle column order, so each maps the same value to the same column as before.
- `scripts/test/positional-inserts.test.ts` also allows `insert-select.ts` (the helper builds a sub-table insert).
- Purge test: an ended import whose file was still kept and older than 24 h is also gone after a start, because the sweep (which runs first) clears its key and the purge then removes the row.
- The probe test's first case (database column only) passes on both trees; the second (Drizzle knows the column) failed on the unfixed tree: account create answered 500, then, with accounts fixed, the import answered 500.
