# Import hardening: implementation spec (EXF-723, EXF-725)

Design: [import-hardening-design.md](import-hardening-design.md) (decisions, the list of point 6, acceptance
cases 1–12, manifest). Worker and schema only. **Nobody opens the source app or uses a file from it.** No migration,
no route, no tool, no edit to `apps/web/**`, `e2e/**`, a `paths.always_overlap` file, a shared module,
`services/reconcile.ts`, `repositories/reconcile.ts`, `repositories/month-categories.ts`, the months/auto-assign/
`category-activity` files, `plan-export-calls.test.ts` or `plan-import-calls.test.ts`.

Order: tasks 1–3 (EXF-723), 4–8 (EXF-725), 9 (purge), 10 (docs). **Commit after each task.** For each test written
for a fault (tasks 2, 7), first run it against the unfixed code (stash the fix or write the test first) and copy the
failing line into the report.

## Interfaces

```ts
// packages/schema/src/plan-export.ts
import type { PayeeSystem } from "./payees";
import { MANUAL_ADJUSTMENT_PAYEE } from "./accounts";
import { RECONCILE_ADJUSTMENT_PAYEE } from "./reconcile";
import { REGISTER_STARTING_PAYEE } from "./register";
/** The Register text of each system payee, in both directions of the file (export and import). */
export const SYSTEM_PAYEE_NAMES: Record<PayeeSystem, string>; // exhaustive: no Partial, no fallback

// packages/schema/src/plan-import.ts
ImportPlan["payees"]: { name: string; system: PayeeSystem | null }[];

// apps/worker/src/repositories/insert-select.ts (new)
import type { InferInsertModel, SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
export type InsertValues<T extends SQLiteTable> = { [K in keyof InferInsertModel<T>]?: unknown };
/**
 * `insert into "<t>" ("<col>", …) select <v>, … <tail>`: columns named from the Drizzle table, in the key order
 * of `values`; an `SQL` value is inlined, any other value is bound; `undefined` throws; unnamed columns take
 * their SQL default. Returns a Drizzle insert (batchable, `meta.changes` as usual).
 */
export function insertSelect<T extends SQLiteTable>(
  db: Db, table: T, values: InsertValues<T>, tail?: SQL,
): BatchItem; // BatchItem<"sqlite"> from drizzle-orm/batch

// apps/worker/src/repositories/plan-import.ts
type Val = number | "b" | { lit: string };     // JSON index, the plan id, or a SQL literal
export function importColumnNames(t: ImportTable): string[]; // SQL names of the columns SPEC writes
export function purgeEndedStmt(db: Db, before: string): BatchItem;
```

## Tasks

### 1. `SYSTEM_PAYEE_NAMES` and the import mapping (schema)

- `plan-export.ts`: add the constant above (`starting_balance` → `REGISTER_STARTING_PAYEE`, `manual_adjustment` →
  `MANUAL_ADJUSTMENT_PAYEE`, `reconciliation_adjustment` → `RECONCILE_ADJUSTMENT_PAYEE`). Check `pnpm -r typecheck`
  for an import cycle warning or error (the graph was checked: none of `accounts.ts`, `reconcile.ts`, `register.ts`,
  `transactions.ts`, `screen-money.ts`, `transfers.ts`, `months.ts` imports `plan-export` or `plan-import*`).
- `plan-import.ts`: delete `STARTING_BALANCE` and `MANUAL_ADJUSTMENT` (lines 62–63); add a module-level
  `const SYSTEM_OF = new Map(Object.entries(SYSTEM_PAYEE_NAMES).map(([s, n]) => [n, s as PayeeSystem]))`; `payeeOf`
  sets `system: SYSTEM_OF.get(text) ?? null`; line 574 compares with `SYSTEM_PAYEE_NAMES.starting_balance`. Widen the
  `payees` type (line 231) to `PayeeSystem | null` (import the type from `./payees`).
- Tests, `packages/schema/test/plan-export.test.ts`: "SYSTEM_PAYEE_NAMES covers every system payee" (keys sorted ==
  `[...PAYEE_SYSTEMS].sort()`; values distinct; equal the three constants). `packages/schema/test/plan-import.test.ts`:
  a hand-written Plan/Register pair (style of the existing schema samples) with a "Reconciliation Balance Adjustment"
  row and a "Manual Balance Adjustment" row → `plan.payees` holds `{ name: "Reconciliation Balance Adjustment",
  system: "reconciliation_adjustment" }` once and the manual one with `manual_adjustment`.
- Verify: `pnpm vitest run --project unit packages/schema/test/plan-export.test.ts packages/schema/test/plan-import.test.ts`.

### 2. The export writes each system payee under its own name (Worker)

- `services/plan-export.ts` lines 97–103: `const payee = r.transferAccountId ? (r.payeeName ?? "") : r.payeeSystem ?
  SYSTEM_PAYEE_NAMES[r.payeeSystem] : (r.payeeName ?? "");`. No other change in the file (lines, schedules, reads).
- Test (case 1, then cases 3 and 6 in task 3): in `apps/worker/test/plan-import-roundtrip.test.ts` add
  `it("carries a reconciliation adjustment (EXF-723)")`: `buildF()`; read Main Checking's `cleared_balance`
  (`GET /budgets/{bid}/accounts/{aid}`); `reconcile(bid, aid, { statement_balance: cleared - 5000,
  create_adjustment: true, today: "2026-11-16" })` (`reconcile-helpers.ts`) → 200; export with `now=NOW`; assert the
  Register contains `"Main Checking","","11/16/2026","Reconciliation Balance Adjustment","Inflow: Ready to Assign"`
  and the row ends `$5.00,$0.00,"Reconciled"` (match with a regex on one line). **Run this assertion against
  the unfixed export first** and quote the failing line.
- Verify: case 2's grep: `grep -n '"Manual Balance Adjustment"\|"Starting Balance"' apps/worker/src/services/plan-export.ts` prints nothing.

### 3. Round trip and import after reconcile (Worker)

- Continue the test of task 2: import the export (201, `state` `done`), export the new plan with the same `now`,
  compare Plan entries and Register entries byte for byte (as the existing criterion 7 test does). In D1 (`q` from
  `bulk-helpers.ts`): the new plan has exactly one payee with `system = 'reconciliation_adjustment'`, named
  "Reconciliation Balance Adjustment", and the transaction with that payee name has its `payee_id`.
  Check that the export's account sort order and tie order hold (the existing test's comparisons); if the adjustment
  row's tie order breaks the identity, report it, do not alter F.
- New `apps/worker/test/plan-import-reconcile.test.ts` (cases 4, 5): build a `.csv` pair from `sampleFiles()` of
  `plan-import-helpers.ts` plus two Register rows, one in `Main Checking` and one in `Rainy Day Savings` (accounts of
  S), payee "Reconciliation Balance Adjustment", category `"Inflow: Ready to Assign","Inflow","Ready to Assign"`, memo
  built from parts (`["Entered automatically by ", SRC].join("")` with `SRC` built like the helpers' `["YN","AB"].join("")`;
  the literal never appears), cleared `Reconciled`, dates on or before the export date. POST (two `file` parts) →
  201. Assert one `reconciliation_adjustment` payee in the plan, both rows on it, and `count(*)` of payees with that
  name and `system is null` = 0. Then reconcile `Main Checking` of the new plan with `statement_balance = cleared −
  1000`, `create_adjustment: true` → 200: still one payee of that system; `data.adjustment.payee_id` equals its id.
- Verify: `pnpm vitest run --project worker apps/worker/test/plan-import-roundtrip.test.ts apps/worker/test/plan-import-reconcile.test.ts`,
  then the two counting tests unedited: `plan-export-calls.test.ts`, `plan-import-calls.test.ts`.

### 4. `insertSelect` (Worker)

- New `apps/worker/src/repositories/insert-select.ts` with the signature above. Body:
  `const cols = getTableColumns(table)`; `keys = Object.keys(values)`; for each key, a missing `cols[key]` throws
  `Error("insertSelect: <table>.<key> is not a column")`, `values[key] === undefined` throws likewise;
  `sub = sqliteTable(getTableName(table), Object.fromEntries(keys.map((k) => [k, text(cols[k].name)])))`;
  `exprs = keys.map((k) => is(values[k], SQL) ? values[k] : sql\`${values[k]}\`)` (use `is` from `drizzle-orm`; an
  `SQLWrapper` such as a column or a subquery builder is inlined too: check with `typeof v?.getSQL === "function"`);
  return `db.insert(sub).select(sql\`select ${sql.join(exprs, sql\`, \`)} ${tail ?? sql\`\`}\`)`.
  Optional: cache `sub` per table name + key list in a `Map` (statements of one shape repeat).
- **Do not use `db.run(sql)`** for statements that go into `db.batch`: Drizzle 0.45's D1 batch binds through
  `preparedQuery.stmt`, which `SQLiteRaw` lacks.
- Test (case 9) in `apps/worker/test/named-columns.test.ts`, `describe("insertSelect")`:
  `insertSelect(getDb(env), accounts, { id: "x", budgetId: "b", starred: 0 }, sql\`where exists (select 1)\`).toSQL()`
  → `sql` is exactly `insert into "accounts" ("id", "budget_id", "starred") select ?, ?, ? where exists (select 1)`,
  params `["x", "b", 0]`; `{ id: undefined }` throws.

### 5. Convert the in-bounds positional inserts (Worker)

Replace each `db.insert(T).select(sql\`select a, b, … <tail>\`)` with `insertSelect(db, T, { prop: a, … }, sql\`<tail>\`)`,
**same values, same tail, same order**, keys written out per call (never `Object.keys(row)` or a spread of a row: a
row read with `select()` may carry columns the statement must not write). Booleans stay `x ? 1 : 0`. Literals in the
select (`0`, `null`, `'credit_card_payments'`, subqueries) become `sql\`0\`` etc. A column whose old value was a
plain `null` literal may be left out only when the column is nullable; keep it named otherwise.

| File | Functions |
|---|---|
| `repositories/accounts.ts` | `insertIfSortStmt`, `insertIfStmt` (14 keys, `lastReconciledAt` included) |
| `repositories/category-groups.ts` | `insertIfSortStmt`, `insertIfStmt` |
| `repositories/categories.ts` | `insertIfSortStmt`, `insertIfStmt` |
| `repositories/payees.ts` | `insertIfStmt`, `insertSystemIfMissingStmt`, `insertByNameIfMissingStmt` |
| `repositories/transactions.ts` | `insertIfStmt` |
| `repositories/guards.ts` | `logSelectStmt` (tail `from (select lower(hex(randomblob(16))) as h, s.* from (${inner}) s)`) |
| `repositories/imports.ts` | `tombstoneIfStmt` |
| `repositories/targets.ts` | `upsertIfHoldsStmt` |
| `repositories/target-snoozes.ts` | `insertIfStmt` |
| `services/credit-payments.ts` | `paymentCreateStmts` (three statements) |

Drizzle property names are those of `apps/worker/src/db/schema/<table>.ts` (e.g. `changeLog`: `id, budgetId, actor,
action, entityType, entityId, beforeJson, afterJson, createdAt`; read each file, do not guess).
Verify: `pnpm -r typecheck`; then the Worker tests of each resource
(`accounts*`, `account-*`, `categor*`, `payee*`, `transaction*`, `plan-transactions`, `targets*`, `plaid*`/`imports*`,
`card-payments*`, `credit*`, `reconcile*`), all unedited.

### 6. The import's `SPEC` by name (Worker)

- `repositories/plan-import.ts`: `SPEC` becomes `Record<ImportTable, { table: SQLiteTable; json: readonly string[];
  cols: Record<string, Val> }>`, each entry built by a typed helper
  `spec<T extends SQLiteTable>(table: T, json, cols: { [K in keyof InferInsertModel<T>]?: Val })` so an unknown
  property fails the type check. Delete `TABLES`'s use in `insertRowsStmts` (keep `TABLES` for `cleanupStmts`, or use
  `SPEC[t].table`). Entries (JSON index per the existing `json` lists, unchanged):
  - accounts: `id 0, budgetId "b", name 1, type 2, onBudget 3, starred lit 0, closed lit 0, sortOrder 4, createdAt 5`
  - category_groups: `id 0, budgetId "b", name 1, sortOrder 2, hidden lit 0, collapsed lit 0, createdAt 4, updatedAt 5, kind 3`
  - categories: `id 0, budgetId "b", groupId 1, name 2, sortOrder 3, hidden 4, createdAt 7, updatedAt 8, kind 5, accountId 6`
  - payees: `id 0, budgetId "b", name 1, hidden lit 0, system 2, createdAt 3, updatedAt 4`
  - month_categories: `budgetId "b", month 0, categoryId 1, assigned 2, updatedAt 3`
  - transactions: `id 0, budgetId "b", accountId 1, date 2, payeeName 4, categoryId 5, inflowToReadyToAssign 6, memo 7,
    amount 8, cleared 9, approved lit 1, createdAt 15, updatedAt 16, payeeId 3, transferAccountId 11,
    transferTransactionId 12, parentTransactionId 13, splitIndex 14, flagColor 10`
  - scheduled_transactions: `id 0, budgetId "b", accountId 1, dateFirst 2, dateNext 3, frequency lit 'never', amount 4,
    payeeId 5, categoryId 6, inflowToReadyToAssign 7, memo 8, flagColor 9, writeToken 10, createdAt 11, updatedAt 12`

  Check each property name against the Drizzle file; the mapping must equal today's positional one exactly
  (dropped entries are only the `lit("null")` ones).
- `insertRowsStmts`: per part, values = map of `cols` to `sql\`${budgetId}\`` / `sql\`json_extract(j.value, ${"$[i]"})\`` /
  `sql.raw(lit)`; per slice `insertSelect(db, spec.table, values, sql\`from json_each(${json}) j where ${g}\`)`.
- `importColumnNames(t)`: `Object.keys(SPEC[t].cols).map((k) => getTableColumns(SPEC[t].table)[k].name)`.
- Test (case 7) `apps/worker/test/plan-import-columns.test.ts`: `it.each` over the seven tables (title names the
  table): (a) each name of `importColumnNames(t)` is in `Object.values(getTableColumns(table)).map((c) => c.name)`;
  (b) `Object.values(getTableColumns(table)).filter((c) => c.notNull && !c.hasDefault).map((c) => c.name)` minus the
  names = `[]`; (c) `pragma table_info(<t>)` rows with `notnull = 1 and dflt_value is null` minus the names = `[]`.
  Use `expect(missing, \`${t}: ${missing.join(", ")}\`).toEqual([])` so a failure names table and column.
- Verify: that file, `plan-import*.test.ts` (round trip identical, steps, cleanup), and `plan-import-calls.test.ts`
  unedited (≤ 3 D1, ≤ 2 R2; log line `max D1 3, max R2 2` with `--silent=false`).

### 7. The throwaway column (Worker, case 8)

- In `apps/worker/test/named-columns.test.ts`, `describe("a new nullable column on accounts")`:
  `beforeAll`: `await env.DB.prepare("ALTER TABLE accounts ADD COLUMN zz_probe TEXT").run()`; then
  `const probe = text("zz_probe").build(accounts)`, set `(accounts as any)[Table.Symbol.Columns].zzProbe = probe`
  and `(accounts as any).zzProbe = probe` (`Table` from `drizzle-orm`). `afterAll`: delete both properties and
  `ALTER TABLE accounts DROP COLUMN zz_probe`.
- Cases: create a plan (`POST /budgets`), `POST /budgets/{id}/accounts` checking and creditCard → 201 each; `POST
  /budgets/import` with `sampleZip()` → 201 and `select count(*) from accounts where budget_id = ? and zz_probe is not
  null` = 0; reconcile one created account with `create_adjustment: true` and a non-zero difference → 200.
  Add a first `it` before the probe is attached to Drizzle (database column only) doing the account create and import:
  it passes on both trees (design B explains why).
- **Run once on the unfixed tree** (`git stash` tasks 4–6, keep the test): account create must answer 500 (or the
  import); quote the failing assertion and the D1 error line. If it does not fail, stop and report why.
- Isolation: keep the probe in this file only and undo it in `afterAll` (the Drizzle object is module state; tests
  reach the app in-process through `createApp` in `helpers.ts`, which is why the probe takes effect).

### 8. The positional-insert guard (repository test, case 10)

- New `scripts/test/positional-inserts.test.ts` (node, like `repo-hygiene.test.ts`): walk `apps/worker/src/**/*.ts`;
  a hit is `/\.insert\([^)]*\)\s*\.select\(/` over the file text; allowed files (each with its reason in a comment):
  `apps/worker/src/history/change-log.ts` (shared module), `apps/worker/src/repositories/reconcile.ts` (out of
  bounds), `apps/worker/src/repositories/month-categories.ts` (another Build). Fails listing `file:line` of each hit.
  Also assert the three allowed files still hold a hit (so a later conversion removes them from the list).
- Verify: `pnpm vitest run --project scripts scripts/test/positional-inserts.test.ts`; temporarily add a positional
  insert to one file and see it fail, then remove it.

### 9. Purge ended import rows (Worker, case 11)

- `repositories/plan-import.ts`: `purgeEndedStmt(db, before)` =
  `db.delete(planImports).where(sql\`state in ('done', 'abandoned') and r2_key is null and updated_at < ${before}\`)`.
- `services/plan-import.ts` `startImport`: `const before = new Date(now.getTime() - importLimits.staleMs).toISOString()`;
  add `repo.purgeEndedStmt(db, before)` as the **first** statement of the single-path batch and of the stepped-path
  batch (before the inserts, so the import's own new row is never matched). No other call added; `sweep` unchanged.
- Test `apps/worker/test/plan-import-purge.test.ts` with `pinPlanClock()`: insert four `plan_imports` rows by SQL
  (A done, `updated_at` 25 h before the pinned clock, `r2_key` null; B abandoned 25 h; C done 23 h; D writing,
  `updated_at` 1 h, with a hidden plan row so the sweep's guards hold), POST S → 201; A and B gone, C and D unchanged,
  the new import's row present; `continueImportRest(A.id)` → 404. Repeat with `importLimits.chunkRows = 7` (stepped,
  202), restoring it in `afterAll`.
- Verify: that file, `plan-import-steps.test.ts`, `plan-import-calls.test.ts` (unedited).

### 10. Docs

- `docs/conventions.md`: after "Services: D1 calls", a section `## Statements: name the columns` with one rule:
  "No statement depends on a table's column order: every insert or copy names its columns. Use `insertSelect`
  (`repositories/insert-select.ts`) for `insert … select`; Drizzle's `insert(t).select(...)` lists every column of `t`
  and is refused by `scripts/test/positional-inserts.test.ts`. `insert(t).values({...})` names them and is fine."
- `docs/plan-import-design.md`: the Payees bullet (line 129) gains `Reconciliation Balance Adjustment` → system
  `reconciliation_adjustment` (names from `SYSTEM_PAYEE_NAMES`); the Leftovers paragraph gains the purge sentence; a
  new section `## What the file format cannot carry` before "Downstream effects": an account's `last_reconciled_at`
  (the file has no account rows; reconciled rows keep `Reconciled`, the date of the last reconcile is lost) and a
  closed account's state (every imported account is open), plus a pointer to the existing out-of-scope list
  (formats, targets, notes, repeating schedules). Not faults.
- `docs/plan-export-design.md` lines 120–122: the Payee bullet reads: system payees by `SYSTEM_PAYEE_NAMES`
  (`starting_balance` → `Starting Balance`, `manual_adjustment` → `Manual Balance Adjustment`,
  `reconciliation_adjustment` → `Reconciliation Balance Adjustment`), exhaustive, no fallback; D1 calls still 16.
- Append an "As built" note to the design doc if anything departs from it (line numbers, a statement left
  positional, a test changed); a change to an acceptance case to make a test pass is listed as a departure.

## Final check

`pnpm check` (foreground). Then `git diff --stat main` lists only manifest files; `git diff main -- apps/web e2e
packages/core packages/schema/src/common apps/worker/src/history apps/worker/src/middleware
apps/worker/src/repositories/reconcile.ts apps/worker/src/services/reconcile.ts apps/worker/test/plan-export-calls.test.ts
apps/worker/test/plan-import-calls.test.ts package.json` is empty. The report states for this step that it opened
nothing in the source app and used no file from it.
