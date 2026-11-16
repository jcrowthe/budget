# Reflect frame and Net Worth spec (EXF-548, EXF-551)

Design: [reflect-design.md](reflect-design.md) (rules, interfaces, acceptance). Follow `docs/conventions.md`.
Do not edit anything listed in the Lead's note 11 (shell, menu-actions, plan, register, account, existing
`api/*` files, existing routes/services/repositories/schemas/tools, `packages/core/src/**`, existing e2e specs,
`paths.always_overlap`). Importing from those files is fine. `packages/schema` does **not** depend on
`@budget/core` (its `package.json` may not change): the pure files there do their own month arithmetic.

## T1. Migration and table

- `apps/worker/migrations/20261116100200_report_settings.sql`: `CREATE TABLE report_settings (...)` with the
  columns of the design's Data section, `budget_id ... REFERENCES budgets(id)`, `PRIMARY KEY (budget_id, report)`.
  Nothing else (additive). Delete `.e2e-state` after adding it.
- `apps/worker/src/db/schema/report-settings.ts`: `export const reportSettings = sqliteTable("report_settings",
  …)`; camelCase fields (`budgetId`, `report`, `preset`, `startMonth`, `endMonth`, `excludedCategoryIds`,
  `excludedAccountIds`, `hideExportDialog` as `integer(..., { mode: "boolean" })`, `visitedAt`, `updatedAt`),
  `primaryKey({ columns: [t.budgetId, t.report] })`.
- Verify: `apps/worker/test/schema-drift.test.ts` passes.

## T2. Range arithmetic: `packages/schema/src/report-range.ts`

Plain TypeScript (no zod needed):

```ts
export type Month = string; // YYYY-MM-01
export const RANGE_PRESETS = ["this_month","last_3_months","last_6_months","last_12_months",
  "year_to_date","last_year","all_dates","custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export interface RangeFacts { first_month: Month; current_month: Month }
export interface MonthSpan { start_month: Month; end_month: Month }
export function monthIndex(m: Month): number;            // year*12 + month-1
export function monthAt(index: number): Month;
export function addMonthsTo(m: Month, n: number): Month;
export function monthOfDate(isoDate: string): Month;      // "2026-11-15" -> "2026-11-01"
export function monthCount(r: MonthSpan): number;         // inclusive
export function monthsIn(r: MonthSpan): Month[];          // oldest first
export function planFirstMonth(earliest: Month | null, current: Month): Month;
export function presetSpan(p: Exclude<RangePreset,"custom">, f: RangeFacts): MonthSpan; // unclamped
export function clampSpan(r: MonthSpan, f: RangeFacts): MonthSpan;
export function resolveRange(p: RangePreset, custom: MonthSpan | null, f: RangeFacts): MonthSpan;
  // custom with null months -> all_dates; always clamped
export function shiftSpan(r: MonthSpan, dir: -1 | 1): MonthSpan;
export function canShift(r: MonthSpan, dir: -1 | 1, f: RangeFacts): boolean;
export function monthLabel(m: Month): string;             // "Nov 2026"
export function shortMonthLabel(m: Month): string;        // "11/26"
export function rangeLabel(r: MonthSpan): string;         // "Nov 2026" | "Jun 2026 – Nov 2026"
```

Rules exactly as the design's **Range** rules. Tests `packages/schema/test/report-range.test.ts`, today
2026-11-15: every preset (incl. Last 12 = Dec 2025–Nov 2026, Last Year = Jan–Dec 2025); clamping with first
Jun 2026 (Last 12, YTD, All Dates → Jun–Nov; Last Year → Jun–Jun) and first May 2026; `planFirstMonth(null)`
and a future earliest → current; every arrow case of EXF-548 (Jun–Nov both off; Sep–Nov ‹ on › off; Sep–Oct ‹
on › off and ‹ gives Jul–Aug; Jul–Aug ‹ off › on; Nov ‹ on → Oct, › off); year boundaries (Jan 2026 ‹ → Dec
2025); labels with the en dash.

## T3. Net Worth arithmetic: `packages/schema/src/net-worth.ts`

```ts
import type { Month, MonthSpan } from "./report-range";
export interface NetWorthAccountRef { id: string; name: string }
export interface MonthlySum { account_id: string; month: Month; amount: number } // milliunits
export interface NetWorthMonthResult { month: Month; assets: number; debts: number; net_worth: number;
  change: number; change_pct: number | null; accounts: { id: string; name: string; balance: number }[] }
export interface NetWorthResult extends MonthSpan { first_month: Month; has_data: boolean; assets: number;
  debts: number; net_worth: number; change: number; change_pct: number | null; months: NetWorthMonthResult[] }
export function computeNetWorth(input: { accounts: NetWorthAccountRef[]; sums: MonthlySum[];
  first_month: Month; start_month: Month; end_month: Month }): NetWorthResult;
export function percentChange(change: number, base: number): number | null;
export function csvAmount(milliunits: number): string;   // 12849260 -> "12849.26", -5000000 -> "-5000.00"
export function netWorthCsv(r: NetWorthResult): string;
```

- `has_data` = some sum of an included account is dated up to `end_month`.
- `accounts` are the included ones, already in sidebar order; sums of other accounts are ignored; sums may be
  dated before `start_month` (they count in every balance).
- Rules exactly as the design's **Net Worth** rules (sign split, change and its first-month rule, percent
  rounding half away from zero to 1 decimal, null when the base is 0 and the change is not, CSV format).
- Avoid `-0` (`0.00`, never `-0.00`, in the CSV; `debts` is `0`, not `-0`).
- Tests `packages/schema/test/net-worth.test.ts` with the EXF-551 example as monthly sums: NW May→Nov
  500000, 7500000, 10335000, 13229500, 16054260, 19354260, 19299260; Nov assets 24049260, debts −4750000; each
  monthly change and pct (Jun 1400.0 … Nov −0.3, May 0/0); range changes May–Nov 18799260 (3759.9), Sep–Nov
  3245000 (20.2), Jul–Sep 5719260 (55.3) and Jul's first-row change from Jun (2835000, 37.8); Savings at
  −300000 in Nov → assets 23349260, debts −5050000; excluding House and Car Loan; a one-month range; the
  exact CSV string of the ticket (header, Checking, Savings, House, Car Loan, Net Worth; no trailing `\n`), a
  name with a `"`; `csvAmount` of 5 and −5 milliunits (`0.01`, `-0.01`), 4 (`0.00`).

## T4. Schemas: `packages/schema/src/reports.ts`

Import `z` from `@hono/zod-openapi`, `dataEnvelope`, `Month`/`IsoDate` from `./common/*`, `isCalendarDate`
from `./transactions`, `RANGE_PRESETS` from `./report-range`.

- `ReportSlug` (enum of the five slugs, tab order) `.openapi("ReportSlug")`; `REPORT_SLUGS`.
- `RangePreset` enum; `DEFAULT_PRESETS: Record<ReportSlug, RangePreset>` (design's Data section).
- `UNCATEGORIZED_ID = "uncategorized"`.
- `ReportSettings` `{ report, preset, start_month: Month.nullable(), end_month: Month.nullable(),
  excluded_category_ids: string[], excluded_account_ids: string[], hide_export_dialog: boolean }`.
- `ReportSettingsList` `{ last_report: ReportSlug.nullable(), reports: ReportSettings[] }`;
  `ReportSettingsResponse = dataEnvelope(ReportSettingsList)`.
- `ReportSettingsUpdate`: `z.strictObject` of optional `preset`, `start_month`, `end_month`,
  `excluded_category_ids`/`excluded_account_ids` (`z.array(z.string().min(1).max(64)).max(2000)`),
  `hide_export_dialog`, `visited: z.literal(true)`; refinements: at least one key; `custom` needs both months
  and start ≤ end; months only with `preset: "custom"`.
- `Today` = `IsoDate.refine(isCalendarDate)`; `IdList` = optional string → `string[]` (split on `,`, trim,
  drop empties; at most 2000).
- `ReportRangeQuery { preset, start_month?, end_month?, today? }` (custom needs both, start ≤ end);
  `ReportRange { first_month, current_month, start_month, end_month }`; `ReportRangeResponse`.
- `NetWorthQuery { start_month?, end_month?, excluded_account_ids: IdList, today? }` (both months or neither;
  start ≤ end; at most 1200 months); `NetWorthMonth`, `NetWorth` (fields of T3, `.openapi` names),
  `NetWorthResponse`.
- Export types with `z.infer`.

## T5. Repositories

- `apps/worker/src/repositories/report-settings.ts`: `list(db, budgetId)`; `upsertStmt(db, budgetId, report,
  set: Partial<row>, now)` (insert with defaults + `onConflictDoUpdate` of the given columns and `updatedAt`);
  `setHideAllStmt(db, budgetId, value, now)` (UPDATE every row of the plan). Unexecuted statements, as in
  `repositories/ui-state.ts`.
- `apps/worker/src/repositories/reports.ts` (reads only; never import or change the accounts/transactions
  repositories):
  - `reportAccounts(db, budgetId)` → `{ id, name, type, onBudget, closed, starred, sortOrder }[]` of the
    plan's non-deleted accounts ordered by `sortOrder`.
  - `earliestTransactionMonth(db, budgetId)` → `Month | null`: `min(substr(date,1,7)) || '-01'` over
    non-deleted transactions of non-deleted accounts of the plan.
  - `monthlySums(db, budgetId, beforeDate)` → `MonthlySum[]`: `group by account_id, substr(date,1,7)` over the
    same rows with `date < beforeDate` (beforeDate = first day after the end month).

## T6. Services

- `apps/worker/src/services/report-settings.ts` (no `change_log`, like `services/ui-state.ts`):
  - `getReportSettings(env, budgetId): Promise<ReportSettingsList>`: plan must be active
    (`budgetsRepo.findActive`, else `NotFound("Plan")`); rows → five entries in `REPORT_SLUGS` order, NULL
    preset → `DEFAULT_PRESETS`, months null unless `custom`, JSON arrays parsed defensively (bad JSON → `[]`),
    `hide_export_dialog` = any row true (same value in all five), `last_report` = max `visitedAt`.
  - `updateReportSettings(env, budgetId, report, patch: unknown)`: `ReportSettingsUpdate.parse`; plan check; one
    `db.batch([upsertStmt(...), maybe setHideAllStmt(...)])`; a non-custom preset writes null months;
    `visited` writes `visitedAt = now`; returns `getReportSettings`.
- `apps/worker/src/services/reports.ts`:
  - `rangeFacts(db, budgetId, today?)`: current = `monthOfDate(today ?? new Date().toISOString().slice(0,10))`,
    first = `planFirstMonth(await earliestTransactionMonth(...), current)`.
  - `getReportRange(env, budgetId, q: ReportRangeQuery)` → `ReportRange` via `resolveRange`.
  - `getNetWorth(env, budgetId, q: NetWorthQuery)` → `NetWorth`: plan check; span = given months or
    `resolveRange("all_dates")`; accounts = `reportAccounts` in sidebar order (use `sidebarSections` and
    `displayGroup` from `@budget/core/account-types`, skipping the `starred` section; `balance: 0` is fine for
    the ordering) minus `excluded_account_ids` (unknown ids ignored); `computeNetWorth`.
  - `exportNetWorth(env, budgetId, q)` → `{ filename: "budget-reflect-net-worth-<today>.csv", csv }`, `today` =
    `q.today ?? UTC date`.

## T7. Routes

Copy the shape of `routes/ui-state.ts` (tags, `json()`, `defaultHook` → 422, errors 403/404/422).

- `apps/worker/src/routes/report-settings.ts` (tag "Interface state"): `GET /budgets/{budget_id}/report-settings`,
  `PUT /budgets/{budget_id}/report-settings/{report}` (`report` param = `ReportSlug`).
- `apps/worker/src/routes/reports.ts` (tag "Reports"): `GET /budgets/{budget_id}/reports/range`,
  `GET /budgets/{budget_id}/reports/net-worth`, `GET /budgets/{budget_id}/reports/net-worth/export` (200
  `text/csv` with schema `z.string()`; return `c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": \`attachment; filename="${filename}"\` })`).
- Verify: `/api/v1/openapi.json` lists the five paths; `openapi.test.ts` passes unedited.

## T8. MCP tool and coverage

- `apps/worker/src/mcp/tools/reports.ts`: `get_net_worth`, input `z.object({ budget_id: Id, start_month:
  Month.optional(), end_month: Month.optional(), excluded_account_ids: z.array(Id).max(2000).optional() })`
  (`Month` from `@budget/schema/common/dates`). Both months or neither, else throw an Error with a clear
  message. Calls `getNetWorth` (no `today`: UTC). Description, at least: what it is for ("net worth each
  month"), `${MONTH}`, "Money is integer milliunits (1000 = one currency unit); debts are negative.",
  defaults (omit both months for the plan's first month through the current month), and `Returns { months,
  assets, debts, net_worth, change, change_pct, … }` with the month fields. `mcp-descriptions.test.ts`
  requires the words "milliunits", "1000 = one currency unit", "YYYY-MM-01" and "Returns", and 80+ characters.
- `apps/worker/test/mcp-coverage/reports.ts` and `report-settings.ts`: the lines in the design's Interfaces
  section, in the shape of `mcp-coverage/ui-state.ts`.

## T9. Worker tests

- `apps/worker/test/report-settings.test.ts`: defaults for a new plan (five entries, presets per
  `DEFAULT_PRESETS`, `last_report` null); PUT custom + exclusions then GET; non-custom preset nulls months;
  422 for: unknown slug, custom without months, start > end, months with a non-custom preset, empty body,
  unknown key; 404 for an unknown plan; hide flag true on one report shows on all five, false clears; `visited`
  on two reports → the later is `last_report`; two plans do not share rows; `apiPaths()` contains both paths.
- `apps/worker/test/reports.test.ts`: build the EXF-551 example through REST (`POST …/accounts` with `balance`
  and `date`, `POST …/transactions`; Car Loan as `otherLiability` entered 5000000 → stored −5000000); range
  presets with `today=2026-11-15` (All Dates May–Nov; Last Year → May–May; empty plan → current..current;
  `today=2026-12-01` → current Dec); net-worth May–Nov (Nov 19299260, assets 24049260, debts −4750000, change
  18799260, pct 3759.9, month changes), Sep–Nov, Jul–Sep, excluded House + Car Loan; omitted months = All
  Dates; 422 for one month only, start > end, a bad `today`; a closed account (set `closed = 1` in `env.DB`)
  sorts last in `accounts` and the CSV; the export: status, headers (`text/csv`, file name with `today`), the
  exact body; MCP `get_net_worth` (via `mcpRpc("tools/call", …)`) deep-equals the REST `data` for the same
  months; `apiPaths()` contains the three paths and `listedToolNames()` contains `get_net_worth`.
- Verify: `pnpm check`.

## T10. Web API: `apps/web/src/api/reports.ts`

- `useReportSettings(budgetId)` (key `["report-settings", budgetId]`), `useUpdateReportSettings(budgetId)`:
  mutation `PUT` with an optimistic update of the cached list (preset/months/exclusions of that report; hide
  flag on all five; `visited` → `last_report`), rollback on error, cache set from the response.
- `useReportFacts(budgetId, today)`: `GET reports/range?preset=all_dates&today=` → `RangeFacts`
  (key `["report-facts", budgetId, today]`); invalidate it on window focus is enough.
- `useNetWorth(budgetId, span, excludedAccountIds, today)` (key includes all; `keepPreviousData`).
- `downloadNetWorthCsv(budgetId, span, excludedAccountIds, today)`: `fetch` (same-origin credentials) →
  blob → object URL → temporary `<a download="budget-reflect-net-worth-<today>.csv">` click → revoke.
- `today` everywhere = `localToday()` from `api/accounts.ts`, read once per render of the page.

## T11. Frame components: `apps/web/src/reflect/`

- `reflect.css`: imported by `ReportFrame.tsx`. Tokens from `shell/tokens.css`; at the top, custom properties
  for the colours with no token: `--reflect-assets: #3d3fb0`, `--reflect-debts: #d0303f`, `--reflect-pill:
  #2e3146`, `--reflect-disabled: #7d8098` (values from the notes; the Designer may correct them). Sizes from the
  design's Source section.
- `icons.tsx`: Calendar, ChevronLeft, ChevronRight, CaretDown, FileText (Export), Check, EyeSlash, Info,
  Search, Close. Own SVG paths (no source art).
- `ReportTabs.tsx`: `<nav aria-label="Reports">` of five `NavLink`s (`reflectPath`), labels Spending
  Breakdown / Spending Trends / Net Worth / Income v Expense / Age of Money; active = `aria-current="page"`.
  No accessible name may contain "Reflect" (the existing specs look for the sidebar's "Reflect" link).
- `ReportFrame.tsx`: props `{ report: ReportSlug; title: string; onExport?: () => Promise<void>; children }`.
  Renders tabs, `<h1>` title, Export button (absent on `age-of-money`, disabled when `onExport` is missing),
  the filter bar per the design (date group, divider, `CategoryFilter`, `AccountFilter`), then children. Reads
  settings + facts, resolves the span with `resolveRange`, and provides `{ span, settings, facts, today }` to
  the body through a React context (`useReportState()`), so later reports reuse it.
- `DateRange.tsx`: the pill (‹ button "Previous Period", label button, › "Next Period"; arrows disabled per
  `canShift`; a shift saves `custom` with the shifted months) and the menu (role `menu`, `menuitemradio` with
  `aria-checked` and a ✓). Custom panel: "Start Date"/"End Date" select buttons (accessible names `Start Date`
  and `End Date`), Cancel, Apply. `MonthGrid.tsx`: year header with "Previous Year"/"Next Year", 12 month
  buttons named `Jan 2026`…, disabled outside [first, current], `aria-pressed` on the selected one. Use
  `useDismiss` (Escape and outside mousedown close; focus back to the trigger).
- `FilterPopover.tsx`: shared shell: portal into `document.body`, positioned under its anchor (clamped to the
  window with an 8px margin, so it fits at 1024×700), `role="dialog"` + label, search input, scroll list
  (max-height so the footer stays on screen), footer: "Select All", "Select None", Cancel, Done.
- `CategoryFilter.tsx` (label "Select Categories"; data from `useMonth(budgetId, monthOfDate(today))`) and
  `AccountFilter.tsx` (label "Select Accounts"; data from `useAccounts`; `sections(accounts, report)` in
  `filters.ts`). Checkboxes are `<input type="checkbox">` inside `<label>` (names = category/account/group/
  section text; section names "Cash Accounts" …); group and section boxes use `indeterminate` when partly
  ticked. Hidden tag: eye-slash icon + text "Hidden". Buttons per the design's label rules (count pill +
  "Selected Categories"; `aria-label` = full text).
- `filters.ts` (pure): `categoryItems(month)`, `accountSections(accounts, report)`, `filterLabel(kind, total,
  selected)`, `excludedAfterDone(listedIds, selectedIds, previousExcluded)`.
- `ExportDialog.tsx`: portal, `.dialog-backdrop` + `.dialog` from `shell/global.css`, `role="dialog"`
  `aria-label="Export Report"`, h2 "Export Report", ✕ button "Close", the ticket's text verbatim (em dash in
  "that—yours!"), checkbox "Don't show again", buttons Cancel and Export (primary). Flow per the design.
- Verify: `pnpm check`; the frame specs of T14.

## T12. Net Worth body: `apps/web/src/reflect/NetWorthReport.tsx`, `NetWorthChart.tsx`, `format.ts`

- `format.ts`: `money(m)` = `formatMoney` (`-$4,750.00`); `debtsMoney(m)` = `"-" + money(|m|)`;
  `signedChange(m)` = `+$…` / `−$…` (U+2212) / `$0.00`; `percent(p)` = 1 decimal with thousands separators
  (`1,400.0%`); `tickMoney` whole dollars.
- Report: `useReportState()` + `useNetWorth`; summary, chart, table exactly as the design's user-visible
  behaviour. Table rows newest first; info icon with a hover/focus tooltip. When `has_data` is
  false the table shows "No information to show" (summary and chart still drawn, all zero).
- Chart: SVG sized by a `ResizeObserver` on its container (height 300); bars per month centred on the month's
  column (each ≤ 40% of the column, Debts left, Assets right); the line and hollow markers on top; y scale from
  min(0, net worths) to max(assets, |debts|, net worths), 5 nice ticks; an invisible `<rect>` per month column
  catches hover and shows the tooltip (`role="tooltip"`); no click handler.
- `onExport` passed to `ReportFrame` = `downloadNetWorthCsv(...)` with the resolved span and exclusions.

## T13. Page: `apps/web/src/pages/reflect.tsx`

- Keep `REPORTS` (page titles), the path, the unknown-slug redirect and `usePageTitle` exactly.
- No report in the URL: render nothing until `useReportSettings` settles, then `<Navigate replace>` to
  `last_report ?? "spending-breakdown"` (also on error).
- With a report: `useEffect` once per slug → `update({ visited: true })`; render `ReportFrame` with title = the
  tab label, body = `NetWorthReport` for `net-worth`, else `<p className="reflect-placeholder">This report is
  not built yet.</p>`.
- Verify: `pnpm e2e e2e/plan-urls.spec.ts e2e/shell.spec.ts` passes unchanged.

## T14. E2E specs

Each test makes its own plan(s) (`request.post("/api/v1/budgets")` with `authHeaders()`, names from
`testName()`), data through the REST API, `page.clock.setFixedTime(new Date("2026-11-15T12:00:00"))` before
`page.goto`. Locators with `{ exact: true }`. A helper `realClick(page, locator)`: scroll into view, take the
box centre, assert `document.elementFromPoint(x, y)` is the element or inside it, `page.mouse.click(x, y)`;
use it for the date pill, menu items, grid months, Apply/Cancel, filter buttons, popover checkboxes and
footer buttons, Export and the dialog buttons. Run the menu/popover/dialog cases at 1600×900 and 1024×700.

- `e2e/reflect-frame.spec.ts`: design cases 1–9 and 17 (case 6 stubs `GET …/accounts*` with `page.route`,
  setting `closed: true, group: "closed"` on one on-plan account; case 9 uses `page.waitForEvent("download")`
  and checks no download fires after Cancel, e.g. within 1s; case 17 uses `test.use({ timezoneId:
  "Pacific/Auckland" })` in its own `describe` and `setFixedTime(new Date("2026-11-30T19:00:00Z"))`, and checks
  the `today=2026-12-01` request with `page.waitForRequest`).
- `e2e/net-worth.spec.ts`: design cases 10–16 and 18 (case 15 reads the download's file and compares the
  exact string; case 16 by `request.get` and an MCP call as `e2e/mcp.spec.ts` does it, without editing it).
- Verify: `pnpm e2e e2e/reflect-frame.spec.ts e2e/net-worth.spec.ts --repeat-each=3`.

## T15. Docs

`docs/README.md` already has the line for this design (Architect). Nothing else to add.
