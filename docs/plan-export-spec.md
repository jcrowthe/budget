# Export Plan, the API half: implementation spec (EXF-476)

Design: [plan-export-design.md](plan-export-design.md). Read its Format, Encoding, Names, Plan file and Register
file sections first: they are the rules; this file gives the tasks, signatures and checks. Files are only those in
the design's Manifest.

Ground rules: the source app is not opened, read or captured. No file under `apps/web/` or `e2e/`, no migration, no
`package.json` or lockfile change, no dependency. Read but never edit `packages/core/**`,
`services/{months,month-categories,auto-assign,transactions,transactions-bulk,accounts}.ts` and their repositories,
routes and tools, `packages/schema/src/{months,month-categories,month-totals,auto-assign,transactions,accounts}.ts`,
`apps/worker/test/{bulk-call-count,credit-call-count}.test.ts`, `bulk-helpers.ts`, `openapi.test.ts`, `mcp.test.ts`.
`services/transactions-export.ts` and `register-export.ts` are not changed (their CSV is another format: quoted
amounts, LF, trailing newline). Test data: no real names or amounts.

## T1. `storeZip` time (`packages/schema/src/zip.ts`, `packages/schema/test/zip.test.ts`)

```ts
export function storeZip(files: ZipFile[], date: string, time?: string): Uint8Array
```

- `time` is `HH:mm` (seconds not written). `dosTime = (Number(h) << 11) | (Number(m) << 5)`; `time` undefined → 0.
- Write it where `u16(0); // time` is today, in the local header **and** the central header.
- Update the file's doc comment ("for the Reflect exports and Export Plan").
- Test, added as a new `it` (existing ones unchanged): `storeZip(files, "2026-11-15", "19:51")` → `getUint16(10)` is
  `(19 << 11) | (51 << 5)`, and the same value at central-header offset `centralStart + 12`; `storeZip(files,
  "2026-11-15")` equals `storeZip(files, "2026-11-15", undefined)` byte for byte and has 0 at offset 10.

## T2. The pure module (`packages/schema/src/plan-export.ts`)

Imports: `z` from `@hono/zod-openapi`, `FLAG_NAMES`, `type FlagColor`, `isCalendarDate` from `./transactions`. No
other package. Exports:

```ts
export const PLAN_HEADER: readonly string[];      // the 7 names of the design
export const REGISTER_HEADER: readonly string[];  // the 11 names

export interface PlanFormat { currency_symbol: string; symbol_placement: "before" | "after" | "none";
  decimal_separator: string; group_separator: string; decimal_digits: number; date_format: string }
export const DEFAULT_PLAN_FORMAT: PlanFormat;     // "$", "before", ".", ",", 2, "MM/DD/YYYY"

export interface ExportFormat { amount(m: number): string; date(iso: string): string;
  delimiter: "," | "\t"; extension: "csv" | "tsv" }
export function exportFormat(f: PlanFormat): ExportFormat;

export function textField(value: string): string;             // guard, then quote (design "Encoding")
export function delimitedFile(lines: readonly string[]): string; // "﻿" + lines.join("\r\n")
export function safeName(name: string): string;                 // name.replace(/[^A-Za-z0-9]+/g, " ")
export function monthLabel(month: string): string;              // "2026-11-01" → "Nov 2026"

export const ExportNow: z.ZodType<string>;   // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, real date, year 19xx–21xx, HH ≤ 23, mm ≤ 59
export const PlanExportQuery: z.ZodObject;   // { now: ExportNow.optional().describe(<text below>) }
export function utcMinute(at: Date): string; // at.toISOString().slice(0, 16)
export function exportNames(planName: string, now: string, ext: "csv" | "tsv"):
  { zip: string; plan: string; register: string };
```

- `amount`: `step = 10 ** (3 - d)`; `units = Math.round(Math.abs(m) / step)` (integers, so half rounds up: away
  from zero on the absolute value); whole = `Math.floor(units / 10 ** d)`, frac = `String(units % 10 ** d)
  .padStart(d, "0")`; number = `d > 0 ? whole + sep + frac : String(whole)`; add the symbol per placement; prefix
  `-` only when `m < 0 && units > 0`. Throw `RangeError` for `d` outside 0..3.
- `date`: `date_format.replace("YYYY", y).replace("MM", mo).replace("DD", d)`.
- `ExportNow` messages: `"now must be YYYY-MM-DDTHH:mm"` (shape) and `"now must be a real date and time"`.
  Description text: `"The caller's local date and time, YYYY-MM-DDTHH:mm; it names the files and sets the current
  month. Defaults to the server's UTC time"`.
- `exportNames`: `stamp = now.slice(0, 10) + " " + now.slice(11, 13) + "-" + now.slice(14, 16)`; `base =
  \`${safeName(planName)} as of ${stamp}\``; `zip: \`Budget Export - ${base}.zip\``, `plan: \`${base} - Plan.${ext}\``,
  `register: \`${base} - Register.${ext}\``.

### Plan rows

```ts
export interface PlanMonthInput { month: string; groups: readonly { name: string; hidden: boolean;
  categories: readonly { name: string; hidden: boolean; assigned: number; activity: number; available: number }[] }[] }
export function planFile(months: readonly PlanMonthInput[], fmt: ExportFormat): string;
```

`MonthDetail` from `@budget/schema/months` fits this shape structurally (do not import it). Per month, in the
order given: one pass collects visible rows (`!g.hidden && !c.hidden`) and hidden rows into two arrays, then
visible + hidden. Text fields through `textField`, joined with `fmt.delimiter`; header from `PLAN_HEADER`. Hidden
rows: group `Hidden Categories`. Return `delimitedFile(lines)`.

### Register rows

```ts
export type CategoryCell = { kind: "none" } | { kind: "rta" }
  | { kind: "category"; group: string | null; name: string; hidden: boolean };
export function categoryCell(row: { onBudget: boolean; categoryId: string | null; inflowToRta: boolean;
  known?: { group: string; name: string; hidden: boolean };
  joined: { group: string | null; name: string | null } }): CategoryCell;

export interface RegisterLine { payee: string | null; memo: string | null; amount: number; category: CategoryCell }
export interface RegisterEntry {
  account: string; accountRank: number; date: string; amount: number; payee: string;
  flag: FlagColor | null; cleared: "uncleared" | "cleared" | "reconciled"; memo: string | null;
  category: CategoryCell; lines: readonly RegisterLine[];   // [] unless a split
  scheduled: boolean; createdAt: string; id: string;
}
export function compareEntries(a: RegisterEntry, b: RegisterEntry): number;
export function registerFile(entries: readonly RegisterEntry[], fmt: ExportFormat,
  flagLabel?: (c: FlagColor) => string): string;   // default (c) => FLAG_NAMES[c]
```

- `categoryCell`: `!onBudget` → none; `categoryId === null` → `inflowToRta ? rta : none`; else `known` ??
  `{ group: joined.group, name: joined.name ?? "", hidden: false }` as `category`.
- Cells: none → `"" "" ""`; rta → `Inflow: Ready to Assign`, `Inflow`, `Ready to Assign`; category hidden →
  `Hidden Categories: <name>`, `Hidden Categories`, name; else (`group` set) `<group>: <name>`, group, name, or (no
  group) name, `""`, name.
- `compareEntries`: `b.date` vs `a.date` (string, descending), then `a.amount - b.amount`, then
  `a.accountRank - b.accountRank`, then `scheduled` (false first), then `createdAt`, then `id` (string ascending).
- `registerFile`: sort a copy with `compareEntries`; an entry with `lines.length > 0` writes one row per line
  (`i` 1-based, `n = lines.length`): payee `line.payee ?? entry.payee`, memo `` `Split (${i}/${n}) ${line.memo ?? ""}` ``,
  line category and amount, everything else from the entry; else one row from the entry. Outflow/Inflow per the
  design. `Cleared` text `Uncleared` / `Cleared` / `Reconciled`.

### Unit tests (`packages/schema/test/plan-export.test.ts`)

Expected strings written by hand from the ticket, never computed by the module:
design cases 3, 4 and 7; `safeName("ZZ-TEST Ex/port: 7")` = `"ZZ TEST Ex port 7"`, `safeName("a🛒b!")` = `"a b "`;
`monthLabel` for Jan and Dec; `exportNames("ZZ-TEST Ex/port: 7", "2026-11-16T09:05", "csv")`; `ExportNow` accepts
`2026-11-16T09:05`, rejects `2026-11-16 09:05`, `2026-02-30T10:00`, `2026-11-16T24:00`, `2026-11-16T10:60`,
`1899-12-31T10:00`; `planFile` on a two-month input with a hidden group and a hidden category (exact text, CRLF,
BOM, no trailing CRLF); `registerFile` on hand-built entries covering: the ticket's Register sample (every row of
it, its seven lines exactly, with `flagLabel` returning `Tax` for the one flag the sample names so), same-date
amount order with a split block, the tie on amount (rank, then scheduled last), a memo with `"`, `,`, `\n` and
emoji.

## T3. Service (`apps/worker/src/services/plan-export.ts`)

```ts
export async function exportPlan(env: Env, budgetId: string, q: { now?: string }):
  Promise<{ fileName: string; bytes: Uint8Array }>;
```

1. `db = getDb(env)`; `plan = await budgetsRepo.findActive(db, budgetId)`, else `throw new NotFound("Plan")`.
2. `now = q.now ?? utcMinute(new Date())`; `today = now.slice(0, 10)`; `current = \`${today.slice(0, 7)}-01\``.
3. `range = await getMonthRange(env, budgetId)` (from `./months`); `first = min(range.first_month, current)`,
   `last = max(current, range.last_assigned_month ?? current)`; `months` = `first`, `addMonths(first, 1)`, … `last`
   (`addMonths` from `@budget/core/month`).
4. One `Promise.all`: `getPlanMonths(env, budgetId, months, today)`, `accountsRepo.list(db, budgetId,
   { includeClosed: true })`, `txRepo.listDetailForPlan(db, budgetId)`, `txRepo.listLines(db, budgetId, {})`,
   `scheduledRepo.listForPlan(db, budgetId)`.
5. Maps: `known` category id → `{ group: g.name, name: c.name, hidden: c.hidden || g.hidden }` from the first month's
   groups; `acct` id → `{ name, rank: index in the list, onBudget }`; `linesOf` parent id → `LineRow[]` (already
   ordered by parent and `splitIndex`).
6. Entries from transactions: `payee` = `r.transferAccountId ? r.payeeName` (already `Transfer : …`) `: r.payeeSystem
   === "starting_balance" ? "Starting Balance" : r.payeeSystem ? "Manual Balance Adjustment" : r.payeeName ?? ""`;
   `category = categoryCell({ onBudget: acct.get(r.accountId).onBudget, categoryId: r.categoryId, inflowToRta:
   r.inflowToReadyToAssign, known: known.get(r.categoryId), joined: { group: r.groupName, name: r.categoryName } })`
   (a row whose account is not in the map is skipped; it cannot happen, the read joins live accounts); `account:
   r.accountName`, `flag: r.flagColor ?? null`, `cleared`, `memo`, `date`, `amount`; lines from `linesOf.get(r.id) ??
   []`: payee `l.transferAccountId ? transferPayeeName(acct.get(l.transferAccountId)?.name ?? "") : l.payeeName`
   (`transferPayeeName` from `@budget/schema/transfers`), memo `l.memo`, `amount`, `categoryCell` of the line with the
   parent's account. `scheduled: false`, `createdAt`, `id`.
7. Entries from schedules: `account: s.accountName`, rank from `acct`, `date: s.dateNext`, `payee: s.payeeName ?? ""`,
   `flag: s.flagColor`, `cleared: "uncleared"`, `memo: s.memo`, `categoryCell({ onBudget: s.accountOnBudget, categoryId:
   s.categoryId, inflowToRta: s.inflowToReadyToAssign, known: known.get(id), joined })`, `lines: []`,
   `scheduled: true`.
8. `fmt = exportFormat(DEFAULT_PLAN_FORMAT)` (EXF-468 replaces this line); `names = exportNames(plan.name, now,
   fmt.extension)`; `bytes = storeZip([{ name: names.plan, data: utf8(planFile(details, fmt)) }, { name:
   names.register, data: utf8(registerFile(entries, fmt)) }], today, now.slice(11, 16))`; return `{ fileName:
   names.zip, bytes }`.

No write, no `change_log`. A short doc comment names the 15 D1 calls.

## T4. Route (`apps/worker/src/routes/plan-export.ts`)

Copy the preamble of `routes/reports.ts` (tags `["Plans"]`, `budgetParam`, `errors`, `defaultHook` → 422). One
`createRoute`: `GET /budgets/{budget_id}/export`, `query: PlanExportQuery`, 200 `application/zip` binary
(description "The plan as a ZIP of the Plan and Register files"). Handler: `exportPlan(c.env, budget_id,
c.req.valid("query"))`, then `c.body(bytes as unknown as ArrayBuffer, 200, { "Content-Type": "application/zip",
"Content-Disposition": \`attachment; filename="${fileName}"\` })`. `export default app`.

## T5. MCP tool (`apps/worker/src/mcp/tools/plan-export.ts`)

```ts
export const tools: McpToolDef[] = [{ name: "export_budget", description, inputSchema:
  z.object({ budget_id: Id, now: PlanExportQuery.shape.now }), run }];
```

`run` returns `{ file_name, content_base64, bytes }`. Base64: a module-local `toBase64(bytes)` that pushes
`String.fromCharCode(...bytes.subarray(i, i + 0x8000))` per chunk into an array, joins once, and calls `btoa`.
Description (≥ 80 chars, starts with what it does): "Export the whole plan as a ZIP of two files, the same as the
REST download. Returns { file_name, content_base64, bytes }: the ZIP's name ('Budget Export - <plan> as of
<YYYY-MM-DD HH-mm>.zip'), its bytes in base64 and its length. '<plan> as of <stamp> - Plan.csv' has one row per
category per month (Month, Category Group/Category, Category Group, Category, Assigned, Activity, Available) from the
plan's first month to the current month or the last month with money assigned; '... - Register.csv' has every
transaction of every account, closed and tracking ones included (one row per split line, transfers as 'Transfer :
<account>'), and each scheduled transaction once at its next date as Uncleared, newest first. Amounts in the files are
formatted text such as $17.34. now is the caller's local date and time, YYYY-MM-DDTHH:mm (default: the server's UTC
time). Read-only. An unknown plan is a tool error."

## T6. Coverage and timestamps

- `apps/worker/test/mcp-coverage/budgets.ts`: add `"GET /budgets/{budget_id}/export": { tool: "export_budget" },`.
- `apps/worker/test/mcp-timestamps.test.ts`: add to `CALLS`, after `get_budget`:
  `["export_budget", (c) => ({ budget_id: c.bid, now: "2026-11-16T09:05" })],`. Nothing else in that file.

## T7. Worker tests

`apps/worker/test/plan-export-helpers.ts`:
- `readZip(bytes)`: walk the end record → central directory → each local header; return `{ name, data, crcOk,
  date, time }[]` in central-directory order (`crc32` from `@budget/schema/zip`; DOS date and time decoded to
  `YYYY-MM-DD` and `HH:mm`); throw when a local header's name or sizes differ from its central entry.
- `text(data)`: `new TextDecoder().decode(data)` with the BOM kept (`{ ignoreBOM: true }`).
- `counting()`: copied from `credit-call-count.test.ts` (it is not exported; do not edit that file).
- `buildF()`: design fixture F through REST (`account(bid, type, balance, name)`-style posts with `date`, category
  groups and categories posts, `PATCH` hidden, `DELETE` of the three default groups, `PUT
  …/months/{month}/categories/{id}` for assignments, transaction posts with `flag_color`/`cleared`/`subtransactions`/
  `transfer_account_id`, one schedule with `?today=2026-11-15`, one `DELETE` transaction, `POST …/close` of Old
  Cash, unapproved set by SQL `update transactions set approved = 0 where id = ?`). Returns the ids it later needs.

`apps/worker/test/plan-export.test.ts` — design cases 1, 2, 5, 6, 8, 9, 12. The expected Plan and Register texts are
string literals written by hand (`\r\n` joins; `﻿` first). Case 5 also compares each row's amounts with
`GET /months/{month}` of that category. Case 1's no-`now` stamp: read `utcMinute(new Date())` before and after
the call and accept either.

`apps/worker/test/plan-export-calls.test.ts` — case 10. Seed the large plan with `env.DB.batch` of plain
`insert into transactions …` statements (100 rows per batch; ids `crypto.randomUUID()`; dates spread over 24
months; categories round-robin over 40; 4 accounts; ten splits of three lines; 20 transfers as linked pairs) and one
`month_categories` row per category per month. Count `exportPlan(counting.env, id, { now })`: assert 15 for F and 15
for the large plan; `console.log` the line `plan-export: <n> transactions, <m> months, <ms> ms`, and the zip's
length. Then write that line into the design's "Largest plan tested" sentence (T8).

## T8. Docs

- `docs/README.md` already has this Build's line (the Architect added it); do not add another.
- Design: replace the placeholder sentence under "D1 calls and size" with the measured numbers.

## Checks

- `pnpm check` passes (lint, typecheck, unit + Worker tests, build).
- `git diff --name-only origin/main...` lists only Manifest files; nothing under `apps/web/`, `e2e/`,
  `packages/core/`, `apps/worker/migrations/`, no `package.json`.
- `pnpm e2e` is not run by this Build (final_gate runs it).
