# Plan export spec (EXF-476, Worker half)

Design: [plan-export-design.md](plan-export-design.md). The rules (format, rows, sort, names, stamp,
decisions) are there; this file gives the interfaces and the order of work. Read `docs/conventions.md`
first. Nobody opens the source app in this Build.

**Do not change**: anything under `apps/web/` or `e2e/`; `packages/core/**`; the out-of-bounds files of the
Lead's note 11 (`packages/schema/src/{months,month-categories,month-totals,auto-assign,transactions,accounts}.ts`,
`apps/worker/src/services/{months,month-categories,auto-assign,transactions,transactions-bulk,accounts}.ts`,
their repositories, routes and tools, `test/bulk-call-count.test.ts`, `bulk-helpers.ts`,
`credit-call-count.test.ts`); any `paths.always_overlap` or `paths.shared_modules` file;
`openapi.test.ts`, `mcp.test.ts`. Importing from them is fine. `transactions-export.ts` and
`register-export.ts` stay as they are (their memo and money rules differ from this format).

## T1. `storeZip` modification time — `packages/schema/src/zip.ts`

- `storeZip(files: ZipFile[], date: string, time = "00:00"): Uint8Array`. Add
  `dosTime("HH:mm") = (h << 11) | (m << 5)` and write it in the "time" field of both the local header and
  the central entry (today both write `0`).
- Verify: `pnpm vitest run packages/schema/test/zip.test.ts` passes unchanged (its date-only call keeps
  time 0).

## T2. Pure format and writers — `packages/schema/src/plan-export.ts`

Imports allowed: `z` from `@hono/zod-openapi`, `FLAG_NAMES`, `FlagColor`, `isCalendarDate` from
`./transactions`, `PayeeSystem` from `./payees`, `transferPayeeName` from `./transfers`. No Worker or DOM
types.

```ts
export interface PlanFormat { currency_symbol: string; symbol_placement: "before" | "after" | "none";
  decimal_separator: string; group_separator: string; decimal_digits: number; date_format: string }
export const DEFAULT_PLAN_FORMAT: PlanFormat;            // "$", "before", ".", ",", 2, "MM/DD/YYYY"
export interface ExportFormat { delimiter: "," | "\t"; extension: "csv" | "tsv";
  amount(milli: number): string; date(iso: string): string }
export function exportFormat(f: PlanFormat): ExportFormat;

export function safeName(planName: string): string;      // /[^A-Za-z0-9]+/g → " ", no trim
export const PlanExportNow: z.ZodString;                  // ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$, real date,
                                                          // hh<24, mm<60; .openapi({ param: { name: "now", in: "query" } })
export const PlanExportQuery: z.ZodObject<{ now: optional PlanExportNow }>;  // .describe(): caller's local
                                                          // date and time; defaults to the server's UTC time
export function exportStamp(now: string): string;         // "2026-11-15T19:51" → "2026-11-15 19-51"
export function exportFileNames(planName: string, now: string, ext: "csv" | "tsv"):
  { zip: string; plan: string; register: string };
export function planMonths(firstMonth: string, nowMonth: string, lastAssigned: string | null): string[];
  // YYYY-MM-01 list, first..max(nowMonth, lastAssigned); if first > last, [last]

export function guardText(s: string): string;             // formula guard only
export function textField(s: string): string;             // guardText, then quote with "" doubling

// Plan file. Structural subset of MonthDetail: the service passes getPlanMonths' result as it is.
export interface PlanExportMonth { month: string; groups: { name: string; hidden: boolean;
  categories: { name: string; hidden: boolean; assigned: number; activity: number; available: number }[] }[] }
export function planFile(months: readonly PlanExportMonth[], fmt: ExportFormat): string;

// Register file
export interface ExportCategory { name: string; group_name: string; hidden: boolean } // hidden: it or its group
export interface ExportPayee { payee_name: string | null; payee_system: PayeeSystem | null;
  transfer_account_name: string | null; transfer_on_budget: boolean | null }
export interface ExportLine extends ExportPayee { amount: number; memo: string | null;
  category_id: string | null; inflow_to_ready_to_assign: boolean }
export interface ExportTransaction extends ExportLine {
  id: string; account_id: string; account_name: string; account_on_budget: boolean; account_sort: number;
  date: string; cleared: "uncleared" | "cleared" | "reconciled"; flag_color: FlagColor | null;
  lines: ExportLine[] }                                   // lines in split order; [] = not a split
export function registerFile(rows: readonly ExportTransaction[],
  categories: ReadonlyMap<string, ExportCategory>, fmt: ExportFormat,
  flagNames?: Partial<Record<FlagColor, string>>): string;
```

Details:

- `amount`: `const q = Math.round(Math.abs(m) / 10 ** (3 - d))`; units `Math.floor(q / 10 ** d)`;
  fraction padded to `d` (none when `d = 0`, and then no separator); sign `-` only when `m < 0 && q > 0`;
  then the symbol by placement.
- `date`: replace `YYYY`, `MM`, `DD` in `date_format` (one pass each).
- The month label is `["Jan", …, "Dec"][m - 1] + " " + yyyy` (no `Intl`).
- `planFile`: per month, two passes over `groups` (in order) and their categories: pass 1 rows where
  `!g.hidden && !c.hidden` with group `g.name`; pass 2 the others with group `Hidden Categories`. Each row
  is `[month label, "<G>: <C>", G, C]` through `textField`, plus three `fmt.amount`, joined by
  `fmt.delimiter`.
- `registerFile`: expand each transaction to rows (the parent itself when `lines` is empty; otherwise
  one per line with the design's split rules), give each row its sort key
  `(date, amount, account_sort, account_id, id, splitIndex)`, sort once (date descending, then the rest
  ascending), and map to text. Payee and category rules are in the design (Register file).
  `transfer_on_budget === true && account_on_budget` is rule 2.
- Both files return `"\uFEFF" + lines.join("\r\n")`.

**Test** `packages/schema/test/plan-export.test.ts`: design cases 3, 4 (pure parts), 6, 7, 11. Also:

- a `planFile` and a `registerFile` call reproducing the ticket's own Plan and Register samples byte for
  byte (with `flagNames = { purple: "Tax" }` for its `"Tax"` row; build the inputs so that the expected
  text is the ticket's sample);
- `amount` with `symbol_placement: "none"` (`45.00`) and `decimal_digits: 0` (`$45`);
- a TSV `planFile` with a `\t` delimiter;
- `PlanExportNow` refuses `2026-02-30T10:00`, `2026-11-15T24:00` and `2026-11-15 19:51`.

Write the expected strings by hand from the ticket and the design, never from the code's output.

## T3. Repository — `apps/worker/src/repositories/plan-export.ts`

Reads only, one statement each, no `json_each` lists needed:

```ts
export interface ExportTxRow { id: string; parentTransactionId: string | null; splitIndex: number | null;
  accountId: string; accountName: string; accountOnBudget: boolean; accountSort: number;
  date: string; amount: number; memo: string | null; cleared: CLEARED; flagColor: FlagColor | null;
  payeeName: string | null; payeeSystem: PayeeSystem | null; categoryId: string | null;
  inflowToReadyToAssign: boolean; transferAccountName: string | null; transferOnBudget: boolean | null }
export async function listTransactions(db: Db, budgetId: string): Promise<ExportTxRow[]>;
export async function listCategories(db: Db, budgetId: string): Promise<Map<string, ExportCategory>>;
```

- `listTransactions` selects every row of `transactions` with `budget_id = ?` and `deleted_at is null`,
  parents, plain rows and lines alike. It inner-joins `accounts` (`deleted_at is null`) and left-joins
  `payees` (name falls back to `transactions.payee_name`, as in `repositories/transactions.ts` `toDetail`)
  and the transfer account alias `ta` (name, `on_budget`).
- `listCategories` covers every category of the plan, deleted ones included, joined to its group:
  `hidden = c.hidden || g.hidden`.
- The account order comes from `accountsRepo.list(db, id, { includeClosed: true })`, which is
  `sort_order` then `id` (`accountSort` = index in that list). Joining `accounts.sort_order` in
  `listTransactions` is equivalent, and then this read is not needed, which makes 14 calls. If that is
  chosen, write the number in the design and the counting test.

## T4. Service — `apps/worker/src/services/plan-export.ts`

```ts
export function planFormatOf(_plan: BudgetRow): PlanFormat;   // DEFAULT_PLAN_FORMAT; EXF-468 plugs in here
export async function exportPlan(env: Env, budgetId: string, now?: string):
  Promise<{ fileName: string; bytes: Uint8Array }>;
```

1. `const at = now ?? new Date().toISOString().slice(0, 16)`. Read the plan with
   `budgetsRepo.findActive`; if it is missing, `throw new NotFound("Plan")`.
2. In one `Promise.all`: `getMonthRange(env, id)`, the three repository reads and
   `scheduledRepo.listForPlan(db, id)`. Then
   `getPlanMonths(env, id, planMonths(range.first_month, at.slice(0, 7) + "-01", range.last_assigned_month), at.slice(0, 10))`.
   It may run inside the same `Promise.all` after `getMonthRange` resolves; the call count stays the
   same.
3. Group the lines by `parentTransactionId`. A row with no parent becomes an `ExportTransaction`, with
   `lines` set to its lines sorted by `splitIndex`. Lines whose parent is missing are dropped.
4. Each schedule becomes an `ExportTransaction` with `id` = the schedule id, `date = dateNext`,
   `cleared: "uncleared"`, `lines: []`, `payee_system: null`, no transfer, `account_on_budget` =
   `accountOnBudget`, and `account_sort` from the account order.
5. `const fmt = exportFormat(planFormatOf(plan))` and `exportFileNames(plan.name, at, fmt.extension)`.
   Encode with one `TextEncoder`, then
   `storeZip([{ name: names.plan, data }, { name: names.register, data }], at.slice(0, 10), at.slice(11, 16))`.
6. Return `{ fileName: names.zip, bytes }`. There is no `change_log` write.

## T5. Route — `apps/worker/src/routes/plan-export.ts`

- `export default new OpenAPIHono<AppEnv>({ defaultHook })`, with the same `defaultHook` as
  `routes/reports.ts` (400 `bad_request`).
- `createRoute({ method: "get", path: "/budgets/{budget_id}/export", tags: ["Plans"], request: { params, query: PlanExportQuery } })`.
- The 200 response is `"application/zip"` with `z.string().openapi({ format: "binary" })` (as in the
  report exports), and the 400 and 404 responses use `ErrorBody`.
- The handler is
  `c.body(bytes as unknown as ArrayBuffer, 200, { "Content-Type": "application/zip", "Content-Disposition": \`attachment; filename="${fileName}"\` })`.
- Verify: `/api/v1/openapi.json` lists the path. `openapi.test.ts` picks it up with no edit.

## T6. MCP tool — `apps/worker/src/mcp/tools/plan-export.ts`

- `export const tools: McpToolDef[] = [{ name: "export_budget", … }]`.
- `inputSchema: z.object({ budget_id: Id, now: PlanExportNow.optional() })`.
- `run` calls `exportPlan` and returns
  `{ file_name: fileName, content_base64: base64(bytes), bytes: bytes.length }`.
- `base64` loops over 0x8000-byte `subarray`s, `String.fromCharCode(...chunk)` into an array, then
  `btoa(parts.join(""))`.
- The description has at least 80 characters and contains "Returns". It says:
  - the tool exports the whole plan as a ZIP of two files, Plan (Month, Category Group/Category,
    Category Group, Category, Assigned, Activity, Available per category per month, from the first
    month through the current month or the last month with money assigned) and Register (every
    transaction of every account, splits as one row per line, transfers on both sides, scheduled
    transactions once at their next date);
  - CSV with US-dollar text amounts and MM/DD/YYYY dates, in UTF-8 with a BOM;
  - `now` is the caller's local date and time, YYYY-MM-DDTHH:mm, used in the file names (default: UTC
    now);
  - it is read-only;
  - "Returns { file_name, content_base64, bytes }".

## T7. Coverage lines

- `apps/worker/test/mcp-coverage/budgets.ts`: add `"GET /budgets/{budget_id}/export": { tool: "export_budget" },`.
- `apps/worker/test/mcp-timestamps.test.ts`: add `["export_budget", (c) => ({ budget_id: c.bid })],`
  to `CALLS` after `get_budget`. At a rebase conflict here, keep every line of both sides.
- Verify: `mcp-coverage.test.ts`, `mcp-descriptions.test.ts`, `mcp-timestamps.test.ts` and `mcp.test.ts`
  pass.

## T8. Test helpers

- `apps/worker/test/zip-reader.ts` exports `readZip(bytes: Uint8Array)`, which returns
  `{ entries: { name, method, flags, dosTime, dosDate, crc, data }[], centralCount, endCount }`.
  - It walks the local headers from offset 0 (signature `0x04034b50`). It reads the central directory
    from the end record's offset (`0x06054b50` at `length - 22`) and checks each central entry's name,
    CRC and local offset against the local header.
  - It computes the CRC-32 itself, with its own table, and asserts that it matches the stored CRC.
  - It decodes names as UTF-8 with `TextDecoder` and does not import `zip.ts`.
- `apps/worker/test/plan-export-fixture.ts` exports `seedExportFixture()`, which builds fixture F with
  the services (`createBudget`, `deleteCategoryGroup` for the defaults, `createCategoryGroup`,
  `createCategory`, the category hidden update, `createAccount` with `date`/`balance`, `setAssigned`,
  `createTransaction` (flag, cleared, subtransactions, transfer_account_id, payee_name), the delete
  service, `closeAccount` with `today`, `createScheduled`), plus direct `env.DB` UPDATEs for the plan's
  `created_at` and the two reconciled sides.
  - It returns `{ bid, hex }`.
  - Read the services' input types before calling them. If a service refuses a step, change the fixture
    with the smallest change and record the departure.
- The counting helper: copy `counting()` from `scheduled-transactions-calls.test.ts` into the calls test.
  Do not import from out-of-bounds tests.

## T9. Worker tests

- `apps/worker/test/plan-export.test.ts` covers design cases 1, 2, 4, 5, 7 (F), 8 and 9.
  - The expected Plan and Register texts are string literals copied from the design. The Register's
    11/12 memo holds `\n`, and lines are joined with `\r\n` in the literal.
  - Compare `new TextDecoder().decode(entry.data)` with `"\uFEFF" + expected`, and also compare the
    first three bytes.
  - The surface checks use `apiPaths()` and `listedToolNames()` from `test/surface.ts`.
- `apps/worker/test/plan-export-calls.test.ts` covers case 10.
  - The large plan is one checking account with a Starting Balance on 2024-12-01, three categories, an
    assignment per category per month, and 1,000 transactions spread over 24 months (2024-12 … 2026-11).
    Insert them with one or a few `env.DB.batch` calls of raw INSERTs, with ids from
    `crypto.randomUUID()`, not through the service.
  - Call `exportPlan(countingEnv, bid, "2026-11-15T19:51")`, assert `calls() === 15` for both plans,
    unzip with `readZip` and assert the Register's line count.
  - Log `performance.now()` around `exportPlan` for both plans and put the times in the design table.

## T10. Docs and checks

- Fill in the design's "Handler time" column with the measured numbers. If the D1 count differs (T3
  option), correct the number in the design and in the tests.
- `docs/README.md` already has this design's line; add nothing else there.
- Run `pnpm check` in the foreground. The full e2e suite is not needed for this Build, which adds no
  spec; final_gate runs it.
- Before finishing, `git diff --stat origin/main` must show only the Manifest's files.
