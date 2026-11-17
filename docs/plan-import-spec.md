# Import Plan (API half) and the export's `now` bound: implementation spec (EXF-477, EXF-670)

Design: [plan-import-design.md](plan-import-design.md). **Never open the source app or use a file from it.** Change
no file of the brief's note 11, no shared module, no `package.json`, nothing under `apps/web/` or `e2e/`.

## Task 0: prove the inflater in the Worker pool (first)

`apps/worker/test/plan-import-zip.test.ts`: bytes compressed with `CompressionStream("deflate-raw")` come back
through the service's `inflateRaw` (task 7). If `DecompressionStream("deflate-raw")` fails in the Worker pool, **stop
and report** before writing an inflater by hand.

## Task 1: zip reader (`packages/schema/src/zip.ts`, beside the unchanged `storeZip`)

```ts
export const ZIP_READ_LIMITS = { maxEntries: 8, maxEntryBytes: 32 * 1024 * 1024 };
export type ZipErrorCode = "zip_corrupt" | "zip_encrypted" | "zip64" | "zip_method"
  | "zip_too_many_entries" | "zip_entry_too_large" | "zip_crc";
export class ZipError extends Error { constructor(readonly code: ZipErrorCode, message: string) }
export function isZip(bytes: Uint8Array): boolean;      // "PK\x03\x04" or "PK\x05\x06"
export function utf8Decode(bytes: Uint8Array): string;  // entry names (no TextDecoder type in this package)
export async function unzip(bytes: Uint8Array,
  inflateRaw: (data: Uint8Array, size: number) => Promise<Uint8Array>,
  limits?: Partial<typeof ZIP_READ_LIMITS>): Promise<ZipFile[]>;   // central-directory order
```

End record found within the last 22 + 65,535 bytes. `0xffff` counts, `0xffffffff` sizes/offsets or a ZIP64 locator →
`zip64`; flag bit 0 → `zip_encrypted`; method ∉ {0, 8} → `zip_method`; > `maxEntries` central entries, or a size >
`maxEntryBytes`, → their codes; names ending `/` or starting `__MACOSX/` skipped; data offset from the local header
(signature checked); inflated length ≠ size or CRC ≠ `crc32` → `zip_crc`; out of bounds → `zip_corrupt`. Messages: "This
ZIP is encrypted; export the plan again without a password", "ZIP64 archives are not supported", "Only stored or
deflated ZIP entries can be read", "The ZIP has more than 8 entries", "A file in the ZIP is larger than 32 MiB", "A
file in the ZIP is damaged (CRC mismatch)", "The file is not a readable ZIP".

Unit tests (`zip.test.ts`, existing cases unchanged): `storeZip` → `unzip`; a deflated zip from Node's global
`CompressionStream` and a header writer written in the test; each refusal from hand-patched bytes; a UTF-8 name.

## Task 2: reading rules (`packages/schema/src/plan-import-read.ts`)

```ts
export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD", "YYYY-MM-DD",
  "DD-MM-YYYY", "DD.MM.YYYY", "YYYY.MM.DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export interface NamedText { name: string; text: string }
export function stripBom(text: string): string;
export function sniffDelimiter(header: string, fileName: string): "," | "\t";  // .tsv → TAB, else whichever gives ≥ 7 fields
export function readDelimited(text: string, delimiter: "," | "\t"): string[][];
export function unguard(field: string): string;                   // /^\\[+\-=@]/ → drop the backslash
export interface ParsedAmount { milliunits: number; symbol: string;
  placement: "before" | "after" | "none"; separator: string | null; digits: number }
export function parseAmount(cell: string): ParsedAmount | null;
export function parseDate(text: string, fmt: DateFormat): string | null;    // ISO
export function dateCandidates(texts: readonly string[]): DateFormat[];     // all formats parsing every text, list order
export function parseMonthLabel(text: string): string | null;               // "Nov 2026" → "2026-11-01"
export function parseExportName(name: string): { name: string; exportDate: string } | null;
export function identifyFiles(files: readonly NamedText[]):
  { plan: NamedText; register: NamedText; delimiter: "," | "\t" };
```

- `readDelimited`: one pass over indices; quoted field = `slice(a, b).replaceAll('""', '"')`, unquoted = slice; CRLF or
  LF ends a record outside quotes; a final empty record dropped; never per-character `+=`. Unclosed quote → 422.
- `parseAmount`: trim; leading `-` = negative; the first and last digit bound the number; inside 0 or 1 non-digit
  (separator) followed by 1–3 digits; trimmed prefix or suffix = symbol (both non-empty → null). `milliunits =
  ±(whole × 1000 + frac padded to 3)`, never `-0`.
- `parseDate`: DD/MM 1–2 digits, YYYY 4, the format's separator, `isCalendarDate`, year 1900–2199.
- `parseExportName`: `/(?:^|Export - )([A-Za-z0-9 ]*?) as of (\d{4}-\d{2}-\d{2}) \d{2}-\d{2}/`, name trimmed.
- `identifyFiles`: first record (BOM stripped) equals `PLAN_HEADER` / `REGISTER_HEADER` of `plan-export.ts`; not one
  of each → `ImportError("not_recognized", "Give the ZIP from Export Plan, or its Plan and Register files")`.

Unit tests (`plan-import-read.test.ts`): the design's amount cases; each date format (`13/05/2026` → `DD/MM/YYYY`
only, `05/06/2026` → both); RFC 4180 edges; `\=bonus`; the three file-name styles; the sniff.

## Task 3: plan builder (`packages/schema/src/plan-import.ts`)

```ts
export const IMPORT_ACCOUNT_TYPES = ["checking","savings","cash","creditCard","lineOfCredit","otherAsset","otherLiability"] as const;
export const IMPORT_ON_BUDGET: Record<ImportAccountType, boolean>;   // cash and credit types
export const IMPORT_LIMITS = { uploadBytes: 20 * 2 ** 20, registerRows: 200_000, planRows: 400_000, warnings: 100, mismatches: 200 };
export const HIDDEN_GROUP = "Hidden Categories";
export type ImportErrorCode = "not_recognized" | "not_utf8" | "bad_amount" | "bad_date" | "bad_month"
  | "date_format_unclear" | "too_large" | "bad_option";
export class ImportError extends Error { constructor(readonly code: ImportErrorCode, message: string) }
export function buildImportPlan(input: { plan: NamedText; register: NamedText; delimiter: "," | "\t";
  zipName: string | null; options: PlanImportOptions; serverToday: string }): ImportPlan;
```

Zod schemas (`z` from `@hono/zod-openapi`, named with `.openapi`): `PlanImportOptions` { name? (trim 1–100),
export_date? (real date 1900–2199), date_format? (enum), account_types? (record → `IMPORT_ACCOUNT_TYPES`),
currency_format? { currency_symbol? (≤ 8), symbol_placement?, decimal_separator? (`.` `,` `-` `/`), decimal_digits?
(0–3) } }; `ImportFormats`, `ImportWarning`, `ImportMismatch`, `ImportAccount`, `ImportCounts`, `ImportSummary`,
`DateQuestion`, `PlanImportPreview`, `PlanImportResult`, `PlanImportCancelResult` as in the design, and their
`dataEnvelope` responses. Money fields use `Milliunits`.

```ts
interface ImportPlan {   // integer keys = indices; the Worker gives ids
  name: string; exportDate: string; firstMonth: string; months: string[];
  formats: ImportFormats; dateQuestion: DateQuestion | null; fileNames: { plan: string; register: string };
  accounts: { name; type; proposedType; reason; onBudget; sort; transactions: number }[];
  groups: { name; sort; kind: "credit_card_payments" | null }[];
  categories: { group: number; name; sort; hidden: boolean; paymentAccount: number | null }[];
  assignments: { category: number; month: string; assigned: number }[];          // non-zero
  payees: { name; system: "starting_balance" | "manual_adjustment" | null }[];
  transactions: { account: number; date; payee: number | null; payeeName: string | null; category: number | null;
    inflowToRta: boolean; memo: string | null; amount: number; cleared: "uncleared" | "cleared" | "reconciled";
    flag: FlagColor | null; order: number; transfer: number | null; transferAccount: number | null;
    parent: number | null; splitIndex: number | null }[];
  schedules: { account; date; payee; category; inflowToRta; memo; amount; flag; order }[];
  planRows: { month: string; label: string; category: number; activity: number; available: number }[];
  warnings: ImportWarning[]; warningCount: number; counts: ImportCounts;
}
```

Rules: the design's "Reading rules" and "Building the plan". Open points settled here:
- Register columns 1 account, 2 flag, 3 date, 4 payee, 6 group, 7 category, 8 memo, 9 outflow, 10 inflow, 11 cleared;
  text columns through `unguard`. Columns 6/7 `Inflow`/`Ready to Assign` → RTA; both empty → none.
- A paired transfer's `payeeName` = `transferPayeeName(other)` (`@budget/schema/transfers`).
- Account order: Kahn's algorithm on edges (account of row i → account of row i+1, both transactions, equal date and
  amount, different accounts), picking the smallest first-appearance index; on a cycle the smallest remaining.
  `order` = Register row index (a split: its first line's).
- Groups: payment group `sort` −1, others 0.. by first appearance, hidden groups (`Hidden Categories`, `(2)`, …) last.
- Warning codes, grouped by (code, subject), ≤ 100 kept: `card_without_account`, `hidden_payment_category`,
  `loan_as_tracking_liability`, `category_not_in_plan_file`, `flag_name_unknown`, `cleared_unknown`,
  `tracking_category_dropped`, `card_own_payment_category`, `split_incomplete`, `split_on_tracking`,
  `split_transfer_line`, `transfer_unpaired`, `scheduled_frequency_unknown`, `scheduled_not_supported`,
  `export_date_missing`, `currency_inconsistent`.
- Counts: `transactions` = non-line rows; `splits` parents; `split_lines`; `transfers_paired` pairs; `scheduled`;
  `months`; `assignments` non-zero cells.
- Unclear dates without `date_format`: built with the first candidate, `dateQuestion` set. A given `date_format` that
  fails → `ImportError("bad_date", "Register line <n>: <text> is not a <fmt> date")`. Over a limit → `too_large`.

Unit tests (`plan-import.test.ts`): S's structure (case 1); every rule above with its edge (incomplete split, two
equal transfer candidates, self-transfer, duplicate hidden names, tie order, a split after the export date).

## Task 4: migration and table

`apps/worker/migrations/20261116101300_plan_imports.sql`:

```sql
CREATE TABLE plan_imports (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('writing', 'done', 'abandoned')),
  actor TEXT NOT NULL,
  file_name TEXT NOT NULL,
  r2_key TEXT,
  chunk_count INTEGER NOT NULL,
  next_chunk INTEGER NOT NULL,
  chunk_offsets TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX plan_imports_state_updated ON plan_imports (state, updated_at);
```

No foreign key (cleanup deletes the plan row, keeps the import row). Drizzle `planImports` in
`apps/worker/src/db/schema/plan-imports.ts`. Delete `.e2e-state`.

## Task 5: repository (`apps/worker/src/repositories/plan-import.ts`)

```ts
export type ImportTable = "accounts" | "category_groups" | "categories" | "payees" | "month_categories"
  | "transactions" | "scheduled_transactions";
export const IMPORT_COLUMNS: Record<ImportTable, readonly string[]>;   // JSON array order (budget_id bound apart)
export type ChunkPart = { t: ImportTable; rows: unknown[][] };
export type Guard = { importId: string; chunk: number } | null;        // null on the single-call path
export function insertRowsStmts(db: Db, budgetId: string, parts: ChunkPart[], guard: Guard, perStatement?: number): BatchItem[];
export function insertPlanStmt(db: Db, row: BudgetRow): BatchItem;     // deletedAt set = hidden
export function insertImportStmt(db: Db, row: PlanImportRow): BatchItem;
export function revealStmts(db: Db, p: { importId: string; chunk: number; budgetId: string; now: string; log: ChangeLogEntry }): BatchItem[];
export function advanceStmt(db: Db, importId: string, chunk: number, now: string, finish: boolean): BatchItem;  // last in the batch
export function cleanupStmts(db: Db, p: { importId: string; budgetId: string; now: string }): BatchItem[];
export function clearKeyStmt(db: Db, importId: string): BatchItem;
export async function find(db: Db, importId: string): Promise<PlanImportRow | undefined>;
export async function findSweepable(db: Db, p: { staleBefore: string; keyBefore: string }): Promise<PlanImportRow | undefined>;
```

- Insert: `insert into <t> (budget_id, <cols>) select ?, json_extract(j.value, '$[0]'), … from json_each(?) j where
  <guard>`, guard `(select next_chunk from plan_imports where id = ? and state = 'writing') = ?` or `1`; via
  `db.run(sql…)` or `insert().select(sql)` (as `credit-payments.ts`); booleans 0/1.
- Columns (what the app writes; `=x` are SQL literals): accounts `id, name, type, on_budget, sort_order, created_at`
  (note, bank_account_id, import_start_date, deleted_at null; starred, closed 0); category_groups `id, name,
  sort_order, kind, created_at, updated_at` (hidden, collapsed 0); categories `id, group_id, name, sort_order, hidden,
  kind, account_id, created_at, updated_at` (note null); payees `id, name, system, created_at, updated_at` (hidden 0);
  month_categories `month, category_id, assigned, updated_at`; transactions `id, account_id, date, payee_id,
  payee_name, category_id, inflow_to_ready_to_assign, memo, amount, cleared, flag_color, transfer_account_id,
  transfer_transaction_id, parent_transaction_id, split_index, created_at, updated_at` (approved 1; import and bank
  columns null); scheduled_transactions `id, account_id, date_first, date_next, amount, payee_id, category_id,
  inflow_to_ready_to_assign, memo, flag_color, write_token, created_at, updated_at` (frequency `'never'`).
- `cleanupStmts`: each delete guarded by `exists (select 1 from plan_imports where id = ? and budget_id = ? and state
  = 'writing') and exists (select 1 from budgets where id = ? and deleted_at is not null)`, in the order
  scheduled_transactions, transactions, month_categories, categories, category_groups, payees, accounts, budgets; then
  `update plan_imports set state = 'abandoned', summary_json = '{}', chunk_offsets = '[]', updated_at = ? where id = ?
  and state = 'writing'`.
- `revealStmts` (before `advanceStmt(…, true)`, same guard): `insert into change_log select … where <guard>`; `update
  budgets set deleted_at = null, updated_at = ? where id = ? and deleted_at is not null and <guard>`.
- `findSweepable`: `(state = 'writing' and updated_at < staleBefore) or (state = 'done' and r2_key is not null and
  updated_at < keyBefore)`, oldest first, limit 1.

## Task 6: comparison (`apps/worker/src/services/plan-import-compare.ts`)

```ts
export function engineInputOf(plan: ImportPlan): EngineInput;   // keys as ids (strings); no notes, no targets
export function compareImport(plan: ImportPlan): { figures: Map<string, { activity: number; available: number }>; // `${category}|${month}`
  mismatches: ImportMismatch[]; mismatchCount: number };
```

Activity per the design's "Comparison" (`planActivity`'s rules), before `addMonths(last Plan month, 1)`, pre-summed
by (month, category, inflow, onBudget, type, card account, transfer) dated the month's first day; one `computeMonth`
per Plan month; each `planRows` entry compared. A Worker test asserts `IMPORT_ON_BUDGET[t] === isOnBudget(t)`.

## Task 7: service (`services/plan-clock.ts`, `services/plan-import.ts`)

```ts
export const planClock = { now: (): Date => new Date() };     // plan-clock.ts; tests assign and restore

export const importLimits = { singleCallRows: 2500, chunkRows: 2500, rowsPerStatement: 250,
  staleMs: 24 * 3600_000, keyGraceMs: 3600_000 };              // tests may lower chunkRows
export const IMPORT_PREFIX = "plan-imports/";
export class ImportRefused extends Error { constructor(readonly status: 404 | 409 | 422, readonly code: string, detail: string) }
export async function inflateRaw(data: Uint8Array, size: number): Promise<Uint8Array>;
export async function startImport(env: Env, actor: string, upload: { files: { name: string; bytes: Uint8Array }[];
  options: PlanImportOptions; dryRun: boolean }):
  Promise<{ status: 200; preview: PlanImportPreview } | { status: 201 | 202; result: PlanImportResult }>;
export async function continueImport(env: Env, importId: string): Promise<{ status: 201 | 202; result: PlanImportResult }>;
export async function cancelImport(env: Env, importId: string): Promise<{ import_id: string; state: "abandoned" }>;
```

- `inflateRaw`: `new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))`, read into a buffer
  of `size`; more bytes → `ZipError("zip_crc", …)`.
- `startImport`: size > `uploadBytes` → 422; one zip → `unzip` (its name is `zipName`), else the two files; decode
  `new TextDecoder("utf-8", { fatal: true })` (`not_utf8`); `identifyFiles`; `buildImportPlan` (`serverToday` from
  `planClock`); `compareImport`; summary. Dry run → 200, no D1/R2 call. Unclear date → 422 `date_format_unclear`,
  detail = question + " Answer with date_format: MM/DD/YYYY (2026-11-05) or DD/MM/YYYY (2026-05-11)." Then: sweep one
  sweepable import (`writing`: cleanup + R2 delete; `done`: R2 delete + `clearKeyStmt`); ids by `crypto.randomUUID()`
  (and each `write_token`); started = `planClock.now()`; plan `created_at` = min(started, `<firstMonth>T00:00:00.000Z`);
  rows' `created_at`/`updated_at` = started + `order` ms; then the design's single or stepped path. Chunks:
  `JSON.stringify` each → `TextEncoder` bytes → one `Uint8Array`, one `FILES.put`; byte ranges in `chunk_offsets`;
  the import row (D1) is written **before** the put.
- History: `ChangeLogEntry { budgetId, actor (the import row's), action: "create", entityType: "budget", entityId,
  before: null, after: { ...toApi(plan, visible), import: {…} } }` (`toApi` from `services/budgets.ts`, read only).
- `continueImport`: unknown → 404; `abandoned` → 409 `import_abandoned` ("This import was cancelled or expired; start
  again"); `done` → 201 from the row; `writing` → R2 `get(key, { range: { offset, length } })` (null → cleanup, 409
  `import_abandoned`), batch (last chunk adds `revealStmts`); thrown batch → cleanup + R2 delete, 422 `import_failed`
  ("The import failed while writing; nothing was kept"); `advanceStmt` changed 0 rows → re-read and answer that
  state; finished → R2 delete, then `clearKeyStmt`.
- `cancelImport`: unknown → 404; `done` → 409 `import_finished` ("This import has finished; delete the plan
  instead"); `abandoned` → 200; else cleanup, R2 delete, 200.

## Task 8: route and tool

`routes/plan-import.ts` (pattern of `routes/plan-export.ts`): `POST /budgets/import` declares `multipart/form-data`
(`file` binary, one or two; option strings) for the document and reads `await c.req.parseBody({ all: true })`;
`currency_format` / `account_types` via `JSON.parse` then `PlanImportOptions.safeParse` (422 with the issues); query
`dry_run` `"true" | "false"`. If the declared body makes the validator reject `File`s, declare `file` with
`z.custom<File | File[]>()` and an `.openapi({ type: "string", format: "binary" })` override (`openapi.test.ts` must
pass). Plus `POST /budgets/import/{import_id}/continue` and `DELETE /budgets/import/{import_id}`. Map `ImportRefused`
→ `apiError(c, status, code, message)`; `ImportError` / `ZipError` → 422 `unprocessable_entity` (except
`date_format_unclear`, which keeps its code). Actor from `c.get("identity").actor`.

`mcp/tools/plan-import.ts`: `import_budget_export` (`files` 1–2 `{ file_name, content_base64 }`, the options,
`dry_run?`; `atob`), `continue_budget_import { import_id }`, `cancel_budget_import { import_id }`. Descriptions:
"Returns { … }", `MONEY`, `DATE`, "creates a new plan and never changes an existing one", "call
continue_budget_import until state is done"; errors are thrown.

Coverage (`mcp-coverage/budgets.ts`): `"POST /budgets/import": { tool: "import_budget_export" }`, `"POST
/budgets/import/{import_id}/continue": { tool: "continue_budget_import" }`, `"DELETE /budgets/import/{import_id}": {
tool: "cancel_budget_import" }`. `mcp-timestamps.test.ts`: `CALLS` for `import_budget_export` (S as base64, name
`ZZ-TEST imported`) and `continue_budget_import` (that import's id: answers done); `NOT_CALLED.cancel_budget_import`
= "needs an unfinished import; covered by plan-import-steps.test.ts"; `export_budget`'s call drops `now`.

## Task 9: EXF-670

- `packages/schema/src/plan-export.ts`: `EXPORT_NOW_MAX_DAYS = 1`, `EXPORT_MONTHS_AHEAD = 24`,
  `nowWithinServerDays(now, serverToday): boolean` (calendar days), `nowRangeText(serverToday)` ("2026-11-15 to
  2026-11-17"), `exportMonthCeiling(serverToday)` (server month + 24, `YYYY-MM-01`); unit tests.
- `services/plan-export.ts`: server date and default `now` from `planClock.now()`; `ExportNowOutOfRange` ("now must be
  within one day of the server's date (<range>)") thrown before any read; `last` capped by `exportMonthCeiling`;
  still 15 calls. `routes/plan-export.ts` maps it to `apiError(c, 422, "unprocessable_entity", …)`; the tool throws.
- `plan-export.test.ts`, `plan-export-calls.test.ts`, `plan-export-helpers.ts` pin `planClock.now` to
  `2026-11-16T12:00:00Z` (restored in `afterAll`); "without now" compares with that minute. New
  `plan-export-now.test.ts`: `2026-11-17T09:05`, `2026-11-15T09:05` → 200; `2026-11-18T00:00`, `2199-12-31T23:59` →
  422 `unprocessable_entity` naming `2026-11-15 to 2026-11-17`, and the same text as an `export_budget` tool error; a
  `month_categories` row (SQL) at `2029-05-01` → the Plan file ends `Nov 2028`, no 2029 row; still 15 calls.
- `docs/plan-export-design.md` line 170: Sep `Rent` $900.00, `Groceries 🛒` $200.00, `Fun "x", y` $50.00, `Hobby`
  $20.00; Oct `Rent` $900.00; Dec `Groceries 🛒` $50.00 (as `plan-export-helpers.ts` lines 154–159 assign).

## Task 10: Worker tests

`apps/worker/test/plan-import-helpers.ts`: `sampleFiles()` (EXF-476's samples as hand-written strings: BOM, CRLF,
`$`, `MM/DD/YYYY`), `deflatedZip(files, name?)` (own header writer + `CompressionStream`), `importForm(files, fields)`
(FormData of `File`s), `postImport(form, query?)` (`call()` + `authed`), `runToDone(first)`, `countingEnv()` (D1 as
`plan-export-helpers.counting`, plus a Proxy counting every `FILES` method), `sourceStyleLarge({ accounts: 30,
categories: 200, months: 96, transactions: 20_000 })` (a text generator in the source's style, written for the test:
compressed `YNAB Export - … as of … .zip`, a split every 50th row, a transfer pair every 40th, rows in export order).

| File | Design cases |
|---|---|
| `plan-import.test.ts` | 1, 2, 3, 4, 5, 6 (S), 12; `IMPORT_ON_BUDGET` vs core |
| `plan-import-roundtrip.test.ts` | 7 (single and stepped) |
| `plan-import-steps.test.ts` | 8, 9 |
| `plan-import-calls.test.ts` | 10, 6 (large dry run); `it(…, 300_000)`; logs case 10's line |
| `plan-import-zip.test.ts` | task 0, 11 |
| `plan-import-migration.test.ts` | 14 (migration statements from `TEST_MIGRATIONS`; an old-style plan inserted by SQL) |
| `plan-export-now.test.ts` | 13 |

Each case checks the database (`env.DB`) as well as the response; plan names start `ZZ-TEST`.

## Task 11: docs and checks

The design's line in `docs/README.md` (union merge; keep every line at a rebase). `pnpm check` passes. Report the
case 10 log line, the D1/R2 maxima, each acceptance case with its test, and that nothing in the source app was opened
or pressed and no file from it was used.

## Task 12: carry-over (tests only; design § Carry-over)

No source change. Each test checks D1 as well as the response; run each new or changed file once and quote it
passing. If a test fails, read the code it exercises before deciding; if the fix would touch a file outside the
manifest, stop and report it.

- **12a, round-trip coverage** (`plan-import-roundtrip.test.ts`, test "gives identical Plan and Register files
  (single call)"): before the import, assert the first export holds each thing the Lead names, by a row of the
  Plan or Register text: a `Credit Card Payments: Sample Visa` Plan row and a `Sample Visa` Register row; `Split (1/2) food`
  and `Split (2/2) ` rows; the pair `Transfer : Rainy Day` / `Transfer : Main Checking`; the 2026-12-01 `Landlord`
  row (scheduled, after `now`); Plan rows `Hidden Categories: Old
  Hobby` and `Hidden Categories: Hobby`; flag
  `Red` on the split rows; `Reconciled` on the transfer rows; a `Dec 2026` Plan row with Assigned `$50.00` for
  `Groceries 🛒`. Read the exact strings from the export (the format is `plan-export-design.md`'s); do not change F.
  After the import, assert in D1 of the new plan: one `creditCard` account with a payment category (`kind` set,
  `account_id` = it), one split parent with 2 lines, 2 rows with `transfer_transaction_id`, 1 `scheduled_transactions`,
  ≥ 1 hidden category, a `flag_color = 'red'` row, 2 `reconciled` rows, a `month_categories` row for `2026-12-01`.
- **12b, bank sync skips a half-written plan** (new `apps/worker/test/plan-import-hidden.test.ts`): `setupPlaid()`,
  `stubBank()`, `world1()` from `plaid-sync-helpers.ts` (a visible Sandbox plan, a connection, `ZZ Checking` linked);
  start a stepped import (`singleCallRows` 0, `chunkRows` 7, restored after) and run one continue; by SQL set
  `bank_account_id` of one account of the hidden plan to the connection's other bank account (`bank["ZZ Savings"]` or
  the second id); `feed.pages` holds one added transaction for each bank account; run the connection's sync
  (`syncOne(w.plan, w.conn)`, and `syncDueConnections(env, …)` as `plaid-sync-budget.test.ts` does). Expected: the
  visible plan's linked account gets its row (the sync ran); the hidden plan's transaction count, accounts and
  `change_log` are unchanged and no row of it has `source = 'plaid'`. Then cancel: nothing of it is left.
- **12c, plan-scoped tools** (same file or `plan-import-steps.test.ts` case 8): between steps, `get_month` (or the
  tool that reads `/months/{m}`) and the accounts list tool on the hidden plan id → `isError` true.
- **12d, an owner-deleted plan survives cancel and sweep** (new file): (i) `buildF()` then `DELETE /budgets/{id}` →
  snapshot of its rows in every table of `TABLES_OF_PLAN` plus its `budgets` row (`deleted_at` set); (ii) an import
  run to done, then its plan deleted the same way, snapshot; (iii) a stepped import left `writing`. Then: cancel of
  (iii) → 200 and (iii) gone; cancel of (ii) → 409 `import_finished`; with `planClock.now` 25 h later a small POST
  (sweep) → 201. Expected: the snapshots of (i) and (ii) are equal before and after, both `budgets` rows still exist
  with `deleted_at` set, and their R2 listing under `plan-imports/` is empty. Also set (ii)'s `r2_key` to a
  dummy key by SQL before the sweep: the sweep clears the key and keeps every row.
- **Report** (Implementer): the case-10 line from `npx vitest run test/plan-import-calls.test.ts --silent=false`
  in `apps/worker` (busiest invocation's D1 and R2, invocations, slowest step and time), and the criteria list of the
  design's Carry-over with any test added here.

## Task 13: thousands separators (design § Second carry-over; the only code change)

Files: `packages/schema/src/plan-import-read.ts`, `packages/schema/src/plan-import.ts`, their tests,
`apps/worker/test/plan-import.test.ts`, `packages/schema/test/plan-export.test.ts`. No Worker source, no D1 call.

```ts
export const GROUPING_CHARS: readonly string[];      // [",", ".", " ", "\u00a0", "\u202f", "'", "\u2019"]
export function detectDecimal(cell: string): string | null;
export function parseAmount(cell: string, decimal?: string | null): ParsedAmount | null;
// ParsedAmount gains `grouping: string | null` (the grouping char, null when none); `separator` stays the decimal.
```

- `parseAmount` with `decimal` undefined or null: **exactly today's behaviour** (the existing unit tests stay as they
  are, `1,234.56` → null). With `decimal` set: the design's rule (old rule with the 3-digit grouping exception, else
  the grouped form). The whole-part 12-digit bound counts digits only. `milliunits` never `-0`.
- `detectDecimal`: trims, takes the span from the first to the last digit, applies the design's two revealing forms;
  null otherwise (no separator, one separator followed by 3 digits, one char repeated).
- `buildImportPlan`: after `readDelimited` of both files and before the Plan loop, `decimal =
  options.currency_format?.decimal_separator ?? first non-null detectDecimal(...)` over `r[4] r[5] r[6]` of Plan rows
  then `r[8] r[9]` of Register rows (stop at the first hit; skip the header rows). The `amount` helper passes
  `decimal` to `parseAmount`; its error message is unchanged. `formats.decimal_separator = cf.decimal_separator ??
  decimal ?? f?.separator ?? "."`. The `currency_inconsistent` warning is unchanged.
- Tests: the design's case 15, each form and each refusal in `plan-import-read.test.ts`; the `,` TSV pair in
  `plan-import.test.ts` (schema); the Worker test in `apps/worker/test/plan-import.test.ts` with totals compared to
  constants computed by hand in the test (not by the parser); the export assertion in `plan-export.test.ts`.
- Verify: `npx vitest run test/plan-import-read.test.ts test/plan-import.test.ts test/plan-export.test.ts` in
  `packages/schema`, `npx vitest run test/plan-import.test.ts test/plan-import-calls.test.ts --silent=false` in
  `apps/worker` (case 10 line unchanged: ≤ 3 D1, ≤ 2 R2), then `pnpm check`. Quote each passing.
