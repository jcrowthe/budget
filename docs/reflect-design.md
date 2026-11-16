# Reflect frame and Net Worth design (EXF-548, EXF-551)

One Build, two tickets: the frame every Reflect report plugs into (EXF-548, without the drill-down) and the
first report in it, Net Worth (EXF-551). Implementation tasks: [reflect-spec.md](reflect-spec.md).

## Source

Studied live in this Thread's own source tab, Reflect pages of the test plan only, on 2026-11-16. Notes and 24
captures cropped to the report area: `/workspace/scratch/source/reflect/notes.md` (`01-…png` to `24-…png`). The
test plan has almost no data, so every report there is empty; the figures and behaviour below come from the
two tickets, which were written from the live source with example data.

What the source shows (details and sizes in the notes):
- **Tab bar** (64px, lighter navy): five labels ~17px semibold; active white with a 3–4px periwinkle underline the
  width of its label (capture 16).
- **Header** on the page background (30px padding): H1 = tab name (24px bold); right: ghost **Export** link
  (document icon, periwinkle). Net Worth also has "Share Your Progress" (not cloned).
- **Filter bar** (32px): grey-blue pill `‹ | 📅 Nov 2026 | ›`, a thin divider, `All Categories ▾` (not on Net
  Worth), `All Accounts ▾`. Age of Money: H1 only (capture 23).
- **Date menu** (04, 05): ~235px card with an up-arrow; presets, divider, Custom; active item periwinkle with a
  right ✓. Custom expands in place: "Start Date" / "End Date" selects (~208×32, `Nov 2026 ▾`), Cancel and
  Apply. **Month grid** (06–08): circled ‹ › around the bold year, Jan…Dec 4×3; selected = filled indigo tile.
- **Category popover** (09–11): ~450px, "Search All Categories", Uncategorized Transactions first, bold groups,
  categories indented 16px, indigo checkboxes; footer links Select All / Select None, buttons Cancel / Done.
  **Account popover** (12): same, "Search All Accounts", bold section rows with their own checkbox.
- **Net Worth, empty** (16–19): one card with the summary (Net Worth `$0.00` 28px; ■ Assets `$0.00`, ■ Debts
  `-$0.00`, Change in Net Worth **$0.00** grey `0.0%`) and the chart (zero line, tick `11/26`, hollow white
  point; hover tooltip Debts / Assets / Net Worth); a second card with the table header and "No information to
  show".
- Not visible in the test plan: non-empty figures, bars, y ticks, rows; enabled grid months; the Hidden tag;
  the Cash/Credit/Tracking sections; the Export dialog (never pressed there; its text is in the ticket).

## Approach

- **Settings are interface state** (like `ui-state`: no `change_log` row, no MCP tool), per plan and report in a
  new table, stored as **exclusions** so new categories and accounts are included by default.
- **Ranges and Net Worth are pure arithmetic** in `packages/schema/src/report-range.ts` and `net-worth.ts`,
  shared by Worker and web, always given "today". The web app sends its **local** date as `today`; the Worker
  falls back to its UTC date. Only the preset is stored (months only for Custom); readers resolve and clamp it.
- REST, the CSV and the MCP tool call one service over a new repository (two queries).
- `pages/reflect.tsx` keeps its route, slugs, redirects and titles and renders `reflect/ReportFrame` (tab bar,
  H1, Export, filter bar) around the body. Own components and stylesheet under `apps/web/src/reflect/`; it
  imports (never edits) `plan/useDismiss.ts`, `useMonth` (`api/months.ts`), `useAccounts` and `localToday`
  (`api/accounts.ts`). The chart is hand-written SVG; no dependency or lockfile change.

## Data

`report_settings`, migration `20261116100200_report_settings.sql` (Lead's note 3), PRIMARY KEY (budget_id,
report): `budget_id` TEXT NOT NULL FK budgets; `report` TEXT NOT NULL (the five slugs); `preset` TEXT NULL (NULL
= the report's default); `start_month`, `end_month` TEXT NULL (only for `custom`); `excluded_category_ids`,
`excluded_account_ids` TEXT NOT NULL DEFAULT '[]' (JSON arrays; `"uncategorized"` stands for Uncategorized
Transactions); `hide_export_dialog` INTEGER NOT NULL DEFAULT 0; `visited_at` TEXT NULL; `updated_at` TEXT NOT NULL.

Default presets (from the tickets): Spending Breakdown `this_month`, Spending Trends `last_3_months`, Net Worth
`all_dates`, Income v Expense `last_3_months`, Age of Money `all_dates` (unused).

**"Don't show again"** is one flag per plan (one user; all interface state here is per plan): true when any
row of the plan has 1. Writing true sets every existing row of the plan and this report's row; false clears
every row. **Last visited tab**: `last_report` = the report of the row with the greatest `visited_at`, or null.

## Interfaces

Paths are under `/api/v1`. Months are `YYYY-MM-01`; money is integer milliunits. Lists in a query string are
comma-separated ids (`excluded_account_ids=a,b`; empty or absent = none). `today` is an optional `YYYY-MM-DD`
(a real calendar date); absent = the Worker's UTC date; its month is the **current month**.

- `GET /budgets/{budget_id}/report-settings` → `{ data: { last_report: Slug|null, reports: ReportSettings[] } }`,
  all five in tab order, defaults filled in. `ReportSettings = { report, preset, start_month, end_month,
  excluded_category_ids, excluded_account_ids, hide_export_dialog }`; `preset` is never null in a response
  (the default replaces NULL); `start_month`/`end_month` are months for `custom`, else null.
- `PUT /budgets/{budget_id}/report-settings/{report}`, body (strict, at least one field): `preset?`,
  `start_month?`, `end_month?`, `excluded_category_ids?` (≤ 2000 ids), `excluded_account_ids?` (≤ 2000),
  `hide_export_dialog?`, `visited?: true`. `preset: "custom"` needs both months with start ≤ end; another preset
  must come without months (the stored months become null). Returns the same body as the GET. Unknown report
  slug or bad body: 422. Unknown plan: 404.
- `GET /budgets/{budget_id}/reports/range?preset=…[&start_month&end_month][&today]` → `{ data: { first_month,
  current_month, start_month, end_month } }` after clamping. `custom` needs both months.
- `GET /budgets/{budget_id}/reports/net-worth?[start_month&end_month][&excluded_account_ids][&today]` →
  `{ data: NetWorth }`. Both months or neither (neither = All Dates resolved with `today`); start ≤ end; at
  most 1200 months; no clamping of explicit months.
  `NetWorth = { first_month, start_month, end_month, has_data, assets, debts, net_worth, change, change_pct, months:
  [{ month, assets, debts, net_worth, change, change_pct, accounts: [{ id, name, balance }] }] }` with months
  oldest first, `accounts` = the included accounts in sidebar order. Header fields (`assets`, `debts`,
  `net_worth`) are those of the last month; `change`/`change_pct` are over the range.
- `GET /budgets/{budget_id}/reports/net-worth/export` (same query) → `text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="budget-reflect-net-worth-<today>.csv"`.
- MCP `get_net_worth { budget_id, start_month?, end_month?, excluded_account_ids? }` → the same `NetWorth`.

Coverage lines:
- `apps/worker/test/mcp-coverage/reports.ts`:
  - `GET /budgets/{budget_id}/reports/net-worth`: `{ tool: "get_net_worth" }`.
  - `GET …/reports/net-worth/export`: excluded, "a CSV file download; get_net_worth returns the same figures".
  - `GET …/reports/range`: excluded, "interface plumbing for the date menu's presets; get_net_worth takes
    explicit months and defaults to the plan's first month through the current month".
- `apps/worker/test/mcp-coverage/report-settings.ts`: both operations excluded, "interface state".

## Rules

**Range** (report-range.ts; `first` = plan's first month, `current` = month of today):
- Plan's first month = month of the earliest non-deleted transaction of a non-deleted account of the plan,
  any account, regardless of filters; when there is none or it is after `current`, `current`.
- Presets: This Month = current; Last 3/6/12 Months = current−2/−5/−11 … current; Year To Date = Jan of
  current's year … current; Last Year = Jan … Dec of the previous year; All Dates = first … current; Custom =
  the stored months.
- Clamp: start = max(start, first), end = min(end, current); if then start > end: the range lay entirely before
  the plan → [first, first]; entirely after today → [current, current].
- Arrows: L = months in the range; ‹ gives [start−L, end−L], disabled when start−L < first; › gives
  [start+L, end+L], disabled when end+L > current. A shift saves preset `custom` with the new months.
- Label: `Nov 2026` for one month, `Jun 2026 – Nov 2026` (spaces around an en dash) for a range.

**Net Worth** (net-worth.ts):
- Included accounts: the plan's non-deleted accounts (on-plan, tracking, loans, closed) minus
  `excluded_account_ids`, in sidebar order (cash, credit, loans, tracking, then closed by name; within a
  section by the stored order).
- Balance(account, m) = sum of its non-deleted transactions dated on or before the last day of m.
- Per month: assets = sum of positive balances; debts = sum of negative balances (≤ 0); net_worth = assets +
  debts.
- Monthly change: change(m) = NW(m) − NW(m−1), `change_pct` = change ÷ |NW(m−1)| × 100 rounded half away from
  zero to 1 decimal; when m ≤ the plan's first month: change 0, pct 0. When NW(m−1) is 0: pct 0 if change is 0,
  else null.
- Range change: NW(end) − NW(start), pct relative to |NW(start)| with the same rounding and null rule. A
  one-month range gives 0 and 0.
- CSV: UTF-8 without BOM, LF, no trailing newline. Header `"Account","May 2026",…`; one row per included
  account `"<name>",b1,b2,…` (name quoted, `"` doubled); last row `"Net Worth",…`. Amounts: milliunits ÷ 1000
  to 2 decimals (half away from zero), `-` for negative, no symbol, no separators; zero is `0.00`.

**Filters** (web):
- Category list: the month read for the browser's current month (`useMonth`): groups and their categories in
  plan order, hidden ones included. A category carries the Hidden tag when it or its group is hidden.
- Category button: all listed items selected → `All Categories`; none → `No Categories Selected`; else a count
  pill with N and the text `Selected Categories` (accessible name `N Selected Categories`). N counts selected
  items among the listed ones, Uncategorized Transactions included.
- Account sections (from the account's `group` and `on_budget`): Cash Accounts (`cash`), Credit Accounts
  (`credit`), Tracking Accounts (`tracking` and `loans`, Net Worth only), Closed Accounts (`closed`; on the
  spending tabs only closed accounts with `on_budget`). A section shows only when it has accounts. Button:
  `All Accounts`, `N Selected Accounts`, `No Accounts Selected` (counted over listed accounts).
- Popovers edit a draft: Done saves it (PUT exclusions = listed items not selected, plus excluded ids not
  listed, kept as they were); Cancel or Escape drop it. Done with nothing selected is allowed.
- Search: case-insensitive substring on category names; a group shows when one of its categories matches,
  with only the matching categories; Uncategorized Transactions shows when its label matches. The account
  popover's search does the same over account names with section headers.

## User-visible behaviour

- `/:budgetId/reflect/:report`: the tab bar (links; the active one has `aria-current="page"` and the
  underline), then H1 = tab name, Export at the right, the filter bar, the body. Page titles unchanged.
- Filter bar per tab: date group on every tab but Age of Money; categories button on Spending Breakdown,
  Spending Trends, Income v Expense; accounts button on those three and Net Worth; Age of Money has none and no
  Export. The four tabs without a body show "This report is not built yet." and a disabled Export (Age of
  Money: no Export).
- `/:budgetId/reflect` with no report: waits for the settings, then replaces the address with `last_report`,
  or `spending-breakdown` when there is none or the read fails. Opening a report saves `visited: true`.
  The sidebar link already points at `/reflect`, so the shell is untouched.
- Date menu: a button named by its label (`Nov 2026`) opens a menu (role `menu`, items `menuitemradio` with
  `aria-checked`). A preset closes the menu and saves. Custom expands Start Date / End Date selects (buttons
  showing the month), Cancel and Apply. A select opens a month grid (year with ‹ › named "Previous Year" /
  "Next Year", buttons Jan…Dec named `Jan 2026` …); months before the first month or after the current month
  are disabled; picking a start later than the end moves the end to it, and the other way round. Apply saves
  `custom` and closes; Cancel closes without saving. Arrows are buttons "Previous Period" / "Next Period".
- Export: when the plan's flag is false, a dialog "Export Report" (✕ named "Close"), the ticket's text,
  checkbox "Don't show again", Cancel and primary Export. Export (ticked → saves `hide_export_dialog: true`
  first) downloads the file and closes; Cancel and ✕ download nothing and save nothing. When the flag is true
  Export downloads at once. The download is `budget-reflect-net-worth-<local today>.csv`.
- Net Worth body (layout as capture 16): summary card with Net Worth (big), ■ Assets, ■ Debts (`-$` + absolute
  value; `$0.00` at zero, EXF-591), Change in Net Worth (`+$18,799.26` `↑ 3,759.9%` green; `−$55.00`
  `↓ 0.3%` red; `$0.00` `0.0%` grey; no percent when null). Chart in the same card: per month a red Debts bar
  (height |debts|) left of centre and a blue Assets bar right, a white net-worth line with hollow markers, a zero
  line, at most 5 whole-dollar y ticks, never a step under $1 (4 for the example data: `$0`…`$30,000`; EXF-588), x labels `MM/YY`; hovering a month's column shows the
  tooltip `Sep 2026` / ● Debts `$5,000.00` / ● Assets `$21,054.26` / ▬ Net Worth `$16,054.26`; clicks do
  nothing. Table card: Month · Net Worth · Monthly Change (ⓘ, tooltip "This column highlights how much your net
  worth has changed month over month."), newest first, `Nov 2026`, `$19,299.26` / `-$216,819.97`, changes
  `↑ +$3,300.00 (20.6%)` green, `↓ −$55.00 (-0.3%)` red (U+2212 before the amount, hyphen in the percent),
  `$0.00 (0.0%)` grey. "No information to show" when `has_data` is false (no included account has a transaction up to the end month).

## Downstream effects

EXF-549/550/552/553 replace the placeholder body and enable Export with their own `onExport`, reusing the
settings, range and filters; they must honour the `"uncategorized"` sentinel. EXF-549 adds the drill-down and
`GET …/reports/transactions`; EXF-548 stays open until then (its criterion 9).

## Out of scope

The drill-down popover and `reports/transactions` (EXF-549); the bodies of Spending Breakdown, Spending
Trends, Income v Expense, Age of Money; Share Your Progress; closing accounts (no route; tests stub or write
the database); a per-user (cross-plan) export flag.

## Acceptance

Defaults: a new plan per case; browser clock 2026-11-15 12:00 local; menus, grids, popovers and the dialog
clicked with a real mouse (centre, `document.elementFromPoint` check, `page.mouse.click`) at 1600×900 and
1024×700. **Example data** (EXF-551): Savings (savings) +500.00 on 2026-05-15, +200.00 on
09-01; Checking (checking) +2,000.00 on 06-01, Jul +3,000, −120, −45; Aug +3,000, −80.50, −25; Sep −200,
−60.25, −99.99, +3,000, −15; Oct −250, −30, −150, +3,000, +20, −40; Nov −55; House (otherAsset) +10,000.00 on
06-01, +500.00 on 10-31; Car Loan (otherLiability, entered 5,000.00) on 06-01, +250.00 on 10-01. Names are
`ZZ-TEST …`. Source compare cases: the source's **Reflect pages of the test plan** in this Thread's own source
tab, current theme (dark) and window, no other page; nothing there may be changed, Export never pressed.

1. (548-1) Open `/reflect/net-worth`: five tab links in order; Net Worth has `aria-current="page"` and a 3–4px
   `--actionPrimary` underline; H1 "Net Worth"; title `Net Worth Report | <plan> | Budget`. Click each tab:
   URL, H1 and underline follow. Compare: source Net Worth tab, capture 16 layout (tab bar, H1, Export,
   filter bar positions).
2. (548-2) Example data (earliest transaction 2026-05-15): Net Worth → menu → All Dates →
   label `May 2026 – Nov 2026`; Last 3 Months → `Sep 2026 – Nov 2026`; This Month → `Nov 2026`; Last Year →
   `May 2026`. Menu check mark on the chosen item. Compare: source date menu look (capture 04).
3. (548-3) Plan whose earliest transaction is 2026-06-01: Custom Sep–Oct → ‹ gives `Jul 2026 – Aug 2026` and
   the menu shows Custom checked; at Jul–Aug ‹ is disabled and › enabled; Last 3 Months (Sep–Nov): › disabled,
   ‹ enabled; All Dates (Jun–Nov): both disabled.
4. (548-4) Same plan, Custom: Start Date grid shows 2026 with Jan–May and Dec disabled, Jun–Nov enabled; ‹ to
   2025 shows all disabled. Pick Jul start, Sep end, Apply → `Jul 2026 – Sep 2026`. Cancel instead leaves the
   label as it was. Compare: source Custom view and month grid (captures 05–08).
5. (548-5) Spending Breakdown with group `ZZ-TEST G` holding `Fun Money`, `Food`, and hidden `Gifts`: the
   popover lists Uncategorized Transactions first, the plan's groups in plan order with indented categories;
   `Gifts` carries an eye-slash and "Hidden". Untick the group: its categories untick; tick it: they tick.
   Type `fun`: only `Fun Money` under `ZZ-TEST G` (and any other matching category under its group). Select None
   → Done: button `No Categories Selected`. Compare: source category popover (captures 09–11).
6. (548-6) Accounts Checking, Credit (creditCard), House (otherAsset), Loan (autoLoan), and one on-plan account
   shown closed (the spec stubs the accounts read): Spending Breakdown's account popover shows Cash Accounts,
   Credit Accounts, Closed Accounts only; Net Worth's adds Tracking Accounts with House and Loan. A section
   checkbox ticks and unticks its accounts. On Net Worth untick House, Done: `4 Selected Accounts` (counted
   over the five listed); reopen: House unticked. Compare: source account popover (capture 12).
7. (548-7) Plan with a Checking Starting Balance on 2026-06-01. Set Spending Breakdown to Last 6 Months with one category excluded; Spending Trends stays on its
   default `Sep 2026 – Nov 2026`, `All Categories`. Go to Plan, back to Reflect, reload: both kept. Then create
   a category through the API: the Spending Breakdown button count rises by one (the new one is ticked).
8. (548-7, note 8) After visiting Net Worth, the sidebar Reflect link opens `/reflect/net-worth`; a new plan's
   first visit opens `spending-breakdown`. `e2e/plan-urls.spec.ts` and `e2e/shell.spec.ts` pass unchanged.
9. (548-8) Net Worth → Export: dialog "Export Report" with the text, checkbox, Cancel, Export. Cancel: no
   download. Export: a download named `budget-reflect-net-worth-2026-11-15.csv`. Again, tick Don't show again,
   Export: download. Reload, Export: download at once, no dialog. Spending Breakdown's Export is disabled.
10. (551-1) Example data, All Dates: header `$19,299.26`, Assets `$24,049.26`, Debts `-$4,750.00`, Change
    `+$18,799.26` `↑ 3,759.9%` green. Table, newest first: Nov `$19,299.26` `↓ −$55.00 (-0.3%)`; Oct
    `$19,354.26` `↑ +$3,300.00 (20.6%)`; Sep `$16,054.26` `↑ +$2,824.76 (21.4%)`; Aug `$13,229.50`
    `↑ +$2,894.50 (28.0%)`; Jul `$10,335.00` `↑ +$2,835.00 (37.8%)`; Jun `$7,500.00` `↑ +$7,000.00 (1,400.0%)`;
    May `$500.00` `$0.00 (0.0%)` grey.
11. (551-2) Custom Sep–Nov: change `+$3,245.00` `↑ 20.2%`. Custom Jul–Sep: Net Worth `$16,054.26`, Assets
    `$21,054.26`, Debts `-$5,000.00`, change `+$5,719.26` `↑ 55.3%`; first row Jul's change uses Jun:
    `↑ +$2,835.00 (37.8%)`.
12. (551-3) Add −1,000.00 to Savings on 2026-11-02 (Savings −300.00 in Nov): Nov Assets `$23,349.26`, Debts
    `-$5,050.00`.
13. (551-4) Hover the Sep column: tooltip `Sep 2026`, Debts `$5,000.00`, Assets `$21,054.26`, Net Worth
    `$16,054.26`. A click on the chart changes nothing. Five Debts and Assets bars for Jul–Nov, x labels
    `07/26`…`11/26`. Compare: source Net Worth tooltip look (capture 17), empty state only.
14. (551-5) Untick Tracking Accounts, Done: button `2 Selected Accounts`; Nov Net Worth and Assets `$13,549.26`
    (Checking 12,849.26 + Savings 700.00), Debts `$0.00` (EXF-591); every row and the chart exclude House and Car Loan
    (Jun `$2,500.00`).
15. (551-6) Export with All Dates: the file is exactly the ticket's CSV: header `"Account","May 2026",…,"Nov
    2026"`, rows Checking, Savings, House, Car Loan in sidebar order (Checking `0.00,2000.00,4835.00,7729.50,
    10354.26,12904.26,12849.26`; Car Loan `0.00,-5000.00,-5000.00,-5000.00,-5000.00,-4750.00,-4750.00`), last row
    `"Net Worth",500.00,7500.00,10335.00,13229.50,16054.26,19354.26,19299.26`, no BOM, LF, no trailing newline.
16. (551-7, 551-8) API `reports/net-worth?start_month=2026-05-01&end_month=2026-11-01&today=2026-11-15`: Nov
    `net_worth` 19299260; MCP `get_net_worth` with the same months returns an equal object.
17. (551-9) Browser in `Pacific/Auckland`, clock 2026-11-30T19:00Z (Dec 1 local): This Month reads `Dec 2026`;
    the request carries `today=2026-12-01`.
18. Empty plan (no accounts): Net Worth shows `$0.00`, `$0.00` (EXF-591), `$0.00 0.0%`, an x tick for the current month,
    "No information to show". Compare: source Net Worth tab as it is (capture 16).

## Manifest

touches: [apps/worker/migrations/20261116100200_report_settings.sql, apps/worker/src/db/schema/report-settings.ts, packages/schema/src/report*.ts, packages/schema/src/net-worth.ts, packages/schema/test/report-range.test.ts, packages/schema/test/net-worth.test.ts, apps/worker/src/repositories/report*.ts, apps/worker/src/services/report*.ts, apps/worker/src/routes/report*.ts, apps/worker/src/mcp/tools/reports.ts, apps/worker/test/report*.test.ts, apps/worker/test/mcp-coverage/report*.ts, apps/web/src/pages/reflect.tsx, apps/web/src/reflect/**, apps/web/src/api/reports.ts, e2e/reflect-frame.spec.ts, e2e/net-worth.spec.ts, docs/reflect-*.md, docs/README.md]
shared: []
migrations: 1
