# Spending Trends and Income v Expense spec (EXF-550, EXF-552)

Tasks for [trends-income-design.md](trends-income-design.md). Read `docs/conventions.md` first. Out of bounds (other
Builds): `packages/core/src/**`, `apps/web/src/plan/**`, `shell/**`, `register/**`, `account/**`, every
`apps/web/src/api/*` but `reports.ts`, the transactions/accounts/payees Worker files and schemas, `mcp/tool-text.ts`
(import only), every always-overlap file, and the never-edit tests (`openapi`, `mcp`, `existing-surface`,
`mcp-coverage`, `mcp-descriptions` tests, `e2e/mcp.spec.ts`). No migration, no dependency. Verify with `pnpm check`
and `pnpm e2e e2e/spending-trends.spec.ts e2e/income-expense.spec.ts e2e/reflect-frame.spec.ts`.

## 1. Pure modules (`packages/schema/src/`)

**`reports.ts`**
- A private helper for the shared span refinements (both months or neither, start ≤ end, < `MAX_REPORT_MONTHS`).
- `SpendingTrendsQuery`: `start_month?`, `end_month?`, `excluded_category_ids: IdList`, `excluded_account_ids: IdList`,
  `group_id?` (1–64), `today?: Today`.
- `IncomeExpenseQuery`: the same, without `group_id`.
- Results exactly as the design's Interfaces, each `.openapi("…")` with a `dataEnvelope` response:
  `SpendingTrendsSeries`, `SpendingTrendsMonth`, `SpendingTrends`, `ReportFigures`, `IncomeExpensePayee`,
  `IncomeExpenseCategory`, `IncomeExpenseGroup`, `IncomeExpense`. Amounts are `z.number().int()`; `compared_pct` and
  `share_pct` are numbers with one decimal.
- `ReportTransactionsQuery` gains:
  - `income_payee_id` (1–64), `income: enum["true"]` and `expenses: enum["true"]` (all optional);
  - `excluded_category_ids: IdList`;
  - the "exactly one" refine counts all six selectors, with the message "Give exactly one of category_id, group_id,
    uncategorized=true, income_payee_id, income=true or expenses=true".

**`reflect-format.ts`** (tests in `reflect-format.test.ts`)
- `minusMoney(m)`: `−$120.00` (U+2212) below zero cents, else `reportMoney(m)`.
- `longMonthLabel("2026-11-01")` = `November 2026`.
- `drillTitle(name, month|null)`: `D8 Food–OCT 2026` (U+2013, no spaces), or `name` when the month is null.

**`spending-breakdown.ts`**: `newestFirst`'s parameters become
`Pick<SpendingRow, "date" | "created_at" | "split_index" | "id">`. Nothing else changes.

**`spending-trends.ts`**
- `TRENDS_UNCATEGORIZED_NAME = "Uncategorized Transactions"`.
- `tenthsHalfUp(n, d)` = `floor((2000·n + d) / (2·d)) / 10` (n ≥ 0, d > 0).
- `comparedPct(diff, avg)` = `avg === 0 ? 0 : tenthsHalfUp(|diff|, |avg|)`.
- `computeTrends({ rows: SpendingRow[], span, group: {id,name}|null }): SpendingTrends`, following the design's
  Arithmetic section:
  - the series key is the group, or `uncategorized` when `category_id` or `group_id` is null; drilled, it is the
    category of the drilled group, and other rows are dropped;
  - plan order is `[group_order, category_order]`;
  - each month lists its non-zero series in rank order;
  - `share_pct` = `amount > 0 && gross > 0 ? tenthsHalfUp(amount, gross) : null`.

**`income-expense.ts`**
- `IncomeRow {id, transaction_id, subtransaction_id, account_id, account_name, date, created_at, split_index, amount,
  payee_id: string|null, payee_name: string|null, memo, cleared}`.
- `NO_PAYEE_ID = "none"`, `NO_PAYEE_NAME = "(no payee)"`.
- `filterIncome(rows, excludedAccountIds)`.
- `computeIncomeExpense({ income: IncomeRow[], spending: SpendingRow[], span }): IncomeExpense`:
  - rows, order and totals as in the design;
  - the Uncategorized row takes `category_id` or `group_id` null;
  - a payee's name is the first row's `payee_name`, else `(no payee)`.
- `incomeExpenseCsv(d: IncomeExpense): string`:
  - no BOM, `"\n"` joins, quoted strings with `"` doubled, `csvAmount` from `net-worth.ts`;
  - month headers `monthLabel`;
  - rows as in the design.

**Unit tests** (`packages/schema/test/spending-trends.test.ts`, `income-expense.test.ts`). They build `SpendingRow`s
for the example: D8 Group, categories Food, Fun, Utilities, Loan Pmt, Hidden; the rows of the ticket; Oct Food
−150000 and +20000; Uncategorized −15000 in Sep.

`computeTrends` must reproduce:
- May–Nov: months `[0,0,165000,105500,175240,450000,55000]`, total 950740, average 135820;
  - `compared_to_average` / `compared_pct`: Nov −80820/59.5, Oct 314180/231.3, Sep 39420/29.0, Aug −30320/22.3,
    Jul 29180/21.5, Jun and May −135820/100.0;
- Sep–Nov: 680240 and 226750: Nov −171750/75.7, Oct 223250/98.5, Sep −51510/22.7;
- Nov only: 55000 and 55000, with 0 and 0;
- Oct series `[{D8 Group, 450000, 100}]`;
- drill D8 Group May–Nov: 935740 and 133680; Oct Loan Pmt 250000/55.6, Food 130000/28.9, Hidden 40000/8.9,
  Fun 30000/6.7, in rank order (range totals 485490, 250000, 100000, 60250, 40000);
- plan T: Nov `[{T Needs 60000 60}, {T Wants 40000 40}, {uncategorized −50000 null}]`, total 50000;
- an empty span: the totals are 0, every month is present, and `compared_pct` is 0.

`computeIncomeExpense` must reproduce every cell of the EXF-552 worked table for May–Nov, with categories in plan
order Hidden, Loan Pmt, Utilities, Fun, Food. That includes the averages 1714290, −2140, −5710, −35710, −8610, −14290,
−69360, −133680, −135820 and 1578470, and the totals 12000000, −950740 and 11049260.
- Plan I's rows: payees I Line Payer 30000, I Parent 50000, Manual Balance Adjustment −250000, `(no payee)` 10000
  with `payee_id` null; total −160000.
- No payees and no spending: `payees: []`, `uncategorized: null`, `groups: []`, every total 0.

`incomeExpenseCsv` for the example May–Nov equals exactly (the file has no BOM and no final LF):

```
"Category","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Average","Total"
"All Income Sources",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00
"D8 Employer",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00
"Total Income",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00
"Uncategorized Transactions",0.00,0.00,0.00,0.00,-15.00,0.00,0.00,-2.14,-15.00
"D8 Group",0.00,0.00,-165.00,-105.50,-160.24,-450.00,-55.00,-133.68,-935.74
"D8 Hidden",0.00,0.00,0.00,0.00,0.00,-40.00,0.00,-5.71,-40.00
"D8 Loan Pmt",0.00,0.00,0.00,0.00,0.00,-250.00,0.00,-35.71,-250.00
"D8 Utilities",0.00,0.00,0.00,0.00,-60.25,0.00,0.00,-8.61,-60.25
"D8 Fun",0.00,0.00,-45.00,-25.00,0.00,-30.00,0.00,-14.29,-100.00
"D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49
"Total Expenses",0.00,0.00,-165.00,-105.50,-175.24,-450.00,-55.00,-135.82,-950.74
"Net Income",0.00,0.00,2835.00,2894.50,2824.76,2550.00,-55.00,1578.47,11049.26
```

`breakdownCsv` for the same rows gives the Food line
`"D8 Group","D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49` (the trends ZIP reuses it).

## 2. Repository (`apps/worker/src/repositories/reports.ts`)

`incomeRows(db, budgetId, { start, endBefore }): Promise<IncomeRow[]>` is one SQL query in the style of
`spendingRows`. It reuses nothing from the transactions repository. Its doc comment states the income rule.
- Same joins as `spendingRows` for accounts (`on_budget = 1`, not deleted), parent `p`, and payees `py`/`pp`; no
  category joins.
- `where`:
  - `t.budget_id = ?`, `t.deleted_at is null`, the date range;
  - `(t.parent_transaction_id is null or p.deleted_at is null)` and the no-live-line `not exists`;
  - `t.inflow_to_ready_to_assign = 1` and `t.transfer_account_id is null`;
  - the effective payee's system is not `starting_balance`.
- Effective payee: `case when t.payee_id is not null or t.payee_name is not null then t.payee_id else p.payee_id end`.
  Its name is `coalesce(py.name, t.payee_name, pp.name, p.payee_name)`, with `pp` used only when the line has no
  payee of its own.

`findPayee(db, budgetId, id): Promise<string | null>` returns a payee name of the plan, deleted ones included.

## 3. Service (`apps/worker/src/services/reports.ts`)

- `reportSpan(db, budgetId, q)`: both months as given, else `resolveRange("last_3_months", null, facts)`.
- `getSpendingTrends(env, budgetId, q)`:
  - `requirePlan`; `group_id` → `findCategoryOrGroup(…"group")`, else `NotFound("Category group")`;
  - `loadSpendingRows` with both exclusions, then `computeTrends`.
- `exportSpendingTrends`: as `exportSpendingBreakdown`, with stem `budget-reflect-spending-trends-${today}` and the
  same two CSV builders; it ignores `group_id`.
- `getIncomeExpense`:
  - `loadSpendingRows` with both exclusions;
  - `filterIncome(await repo.incomeRows(…), excluded_account_ids)`;
  - then `computeIncomeExpense`.
- `exportIncomeExpense`: `{ filename: budget-reflect-income-expense-${today}.csv, csv }`.
- `listReportTransactions`:
  - `income_payee_id` other than `none` → `findPayee`, else `NotFound("Payee")`;
  - income selectors read `incomeRows` (filtered by accounts, and by payee: `none` = `payee_id` null);
  - spending selectors pass `excluded_category_ids` into `loadSpendingRows`, and `expenses` takes every row;
  - map both to `ReportTransaction` (income: `category_id`/`category_name` null), sorted by `newestFirst`.

## 4. Routes (`apps/worker/src/routes/reports.ts`)

Four `createRoute`s in the existing style:
- `GET /budgets/{budget_id}/reports/spending-trends`: json `SpendingTrendsResponse`, "Spending by month";
- `…/spending-trends/export`: `application/zip`, the Content-Disposition attachment;
- `…/income-expense`: `IncomeExpenseResponse`, "Income and expenses by month";
- `…/income-expense/export`: `text/csv; charset=utf-8`.

Every route has the `...errors` responses.

## 5. MCP (`apps/worker/src/mcp/tools/reports.ts`)

Import `MONEY`, `MONTH`, `dates` and `Id`; `checkMonths` as now. Below, SPEND is the existing two-sentence spending
rule, word for word from `get_spending_breakdown`, and INCOME is:

> Income counts rows of on-plan accounts sent to Ready to Assign, whatever their sign, grouped by payee (a split line by
> its own payee, else the split's); a balance adjustment is listed as "Manual Balance Adjustment". Starting Balances and
> transfers are never income, and a row with no payee is listed as "(no payee)" with payee_id null.

**`get_spending_trends`** (inputs as the design). Its description:

> How has my spending changed month to month? Spending per month over a range, by category group (with group_id: by
> that group's categories). ${MONEY} Spending figures here are positive and a net inflow is negative. ${MONTH} Both
> start_month and end_month are required. SPEND Returns { start_month, end_month, group, total, average_monthly,
> series: [{ id, name, total }], months: [{ month, total, compared_to_average, compared_pct, series: [{ id, name,
> amount, share_pct }] }] }, with every month of the range, oldest first.
> - average_monthly is total ÷ months in cents;
> - compared_to_average is the month total minus it, and compared_pct is that difference as a percent of it (one
>   decimal);
> - share_pct is a segment's percent of the month's spending (one decimal), null for a net inflow;
> - series are ordered largest first;
> - the series id "uncategorized" is Uncategorized, and excluded_category_ids may hold it.

**`get_income_expense`**. Its description:

> What was my income and spending each month this quarter? Income by payee and expenses by category group and category,
> month by month, with average, total and net income. ${MONEY} Income is positive and expenses are negative; net income
> is income plus expenses. ${MONTH} Both start_month and end_month are required. INCOME SPEND Returns { start_month,
> end_month, months, income: { payees: [{ payee_id, name, months, average, total }], total }, expense: { uncategorized,
> groups: [{ id, name, categories: [{ id, name, hidden, months, average, total }], total }], total }, net_income }.
> - Each figure set's months holds one amount per entry of months, and average is total ÷ months in cents.
> - uncategorized is null when no row is uncategorized.
> - Only rows with activity are listed, groups and categories in plan order.
> - excluded_category_ids limits expenses only.

**`list_report_transactions`**:
- gains `income_payee_id: Id.optional()` (or "none"), `income: z.literal(true).optional()`,
  `expenses: z.literal(true).optional()` and `excluded_category_ids`;
- the "exactly one" check covers the six selectors;
- its description adds: "income_payee_id lists one payee's income ("none" for rows with no payee), income=true all
  income, expenses=true all spending; excluded_category_ids applies to the spending selectors." plus INCOME.

## 6. Worker tests (`apps/worker/test/`)

- **`report-example.ts`** (new): `examplePlan({ order?, earlyMonth? })`, a copy of the example in
  `spending-breakdown.test.ts` (whose copy stays), returning `{ bid, g, chk, sav, loan }`; `order` sets the category
  creation order.
- **`spending-trends.test.ts`**:
  - the surface (`apiPaths()` with both paths, `listedToolNames()` with the tool);
  - design cases 1, 2, 4 and 5 through the API; a group of another plan → 404; one month only → 422;
  - MCP equals REST;
  - the ZIP read with Python `zipfile`, as `spending-breakdown.test.ts` does;
  - design case 16.
- **`income-expense.test.ts`**:
  - the surface;
  - design cases 9 and 13 through the API, MCP equal to REST;
  - the CSV equal to task 1's text, its first byte not `0xEF`;
  - design case 18; `list_report_transactions` with `income: true`.
- **`spending-breakdown.test.ts`**: design case 17, closing with `update accounts set closed = 1` as
  `reports.test.ts` does.
- **`mcp-coverage/reports.ts`**:
  - `GET …/reports/spending-trends` → `get_spending_trends`, and `GET …/reports/income-expense` → `get_income_expense`;
  - `GET …/reports/spending-trends/export` → `{ excluded: "a ZIP file download of two CSVs; get_spending_trends and
    list_report_transactions return the same figures" }`;
  - `GET …/reports/income-expense/export` → `{ excluded: "a CSV file download; get_income_expense returns the same
    figures" }`.
- **`mcp-timestamps.test.ts`**: after `get_spending_breakdown`, add
  `["get_spending_trends", (c) => ({ budget_id: c.bid, start_month: MONTH, end_month: MONTH })]` and the same for
  `get_income_expense`.

## 7. Web API (`apps/web/src/api/reports.ts`)

- `useSpendingTrends(budgetId, span, excludedCats, excludedAccts, groupId, today)`:
  - key `["spending-trends", budgetId, span, excludedCats, excludedAccts, groupId, today]`;
  - `placeholderData: keepPreviousInPlan(budgetId)`.
- `useIncomeExpense(budgetId, span, excludedCats, excludedAccts, today)`: key `["income-expense", budgetId, …]`, the
  same placeholder.
- `downloadSpendingTrendsZip(...)` and `downloadIncomeExpenseCsv(...)`, like `downloadSpendingBreakdownZip`, with the
  file names of the design.
- `ReportTransactionSelector` adds `{ income_payee_id: string } | { income: true } | { expenses: true }`.
  `useReportTransactions(budgetId, span, selector, excludedAccts, excludedCats: string[] = [])` puts `excludedCats` in
  the key and sends `excluded_category_ids` when it is not empty.

## 8. Web screens (`apps/web/src/reflect/`, `pages/reflect.tsx`)

**`pages/reflect.tsx`**:
- `spending-trends` → `<SpendingTrendsPage title={title} />`;
- `income-expense` → `<ReportFrame report="income-expense" … onExport={downloadIncomeExpenseCsv(…)}>` with
  `<IncomeExpenseReport />`;
- the placeholder line stays for Age of Money only.

**`TransactionPopover`** gains optional `span?: MonthSpan` (default: the state's span) and `excludedCategoryIds?:
string[]`, both passed to `useReportTransactions`.

**`icons.tsx`**: `CaretRightIcon` (viewBox like `CaretDownIcon`, the triangle pointing right, 8×8 where used).

**`SpendingTrendsPage.tsx`**: copies `SpendingBreakdownPage`'s drill and breadcrumb (`sb-breadcrumb`, `sb-crumb`). Its
export is `downloadSpendingTrendsZip` with the frame's span and filters.

**`SpendingTrendsReport.tsx`**:
- reads `useSpendingTrends`, then renders the chart card (averages + `TrendsChart`) and `TrendsTable`;
- keeps the popover state `{ title, selector, span: {month, month}, x, y }`;
- renders `TransactionPopover` with that span.

**`TrendsChart.tsx`** (own SVG; `ResizeObserver` width as `NetWorthChart`):
- Geometry: height 320, plot top 24, plot height 266; left 72 with y ticks, else 21; right 5. Bars `min(col·0.5, 48)`.
- Ticks: `niceTicks(lo, hi)` (lo = min(0, lowest negative stack, totals), hi = max(0, top stack, totals)); none →
  domain ±1000. Y labels `tickMoney` 11/500 `--labelSecondary` at left − 8; gridlines and the bottom axis
  `stroke: var(--st-grid); stroke-dasharray: 2 2`; x ticks 6px and `shortMonthLabel` labels 11/500 `--labelPrimary`.
- Segments `<rect class="st-seg" data-month data-series>`: fill `--sb-slice-(rank+1)` (beyond 8:
  `--sb-slice-other`), stroke 0, pointer. Positives stack up from 0 by rank; negatives stack down.
- Line `<path class="st-line">` 2px `--labelPrimary` through the totals; markers `<circle class="st-marker"
  data-month r=5>` (fill `--backgroundPrimary`, 2px `--labelPrimary` stroke) with a transparent r=10 hit circle.
- Tooltip `role="tooltip"` `.st-tooltip`, centred 12px above the hovered top:
  - bg `--backgroundTertiary`, radius 4, padding 8px 16px, max-width 160, min-height 64;
  - shadow `0 10px 20px rgba(0,0,0,.15), 0 3px 6px rgba(0,0,0,.1)`, and a 15px down arrow;
  - lines 14/500 primary, 16/900, 14/500 `--labelSecondary` (`percent(p) + " of Total"`; `minusMoney` for a net
    inflow).
- Segment clicks: not drilled, a group → `onDrill` and `uncategorized` → `{ uncategorized: true }`; drilled →
  `{ category_id }`. Title `drillTitle(name, month)`.

**`TrendsTable.tsx`**: `<table class="st-table">` in a card with no padding.
- Header 14/500 `--labelSecondary`, padding 16px 24px, gap 16: `Month` (fills, left), `Total Spending` (right),
  `Compared to Average` (11rem, right) + 8px + `<button aria-label="About Compared to Average">` with `InfoIcon`
  12×16 `--labelTertiary`.
- Info tooltip `role="tooltip"` on hover or focus: bg `--inputBackground`, `--st-info-text` 12/400, padding 8,
  radius 6, width 288, shadow `0 2px 5px rgba(0,0,0,.15)`, above the icon; opacity transition `.1s 1.9s`.
- Body: border-top 1px `--borderSubtle`, padding 8.
- Rows newest first, padding 8px 16px, 14/500 `--labelSecondary` (`--labelPrimary` on hover): `longMonthLabel`,
  `money(total)`, `↑`/`↓` + `signedChange(diff)` + ` (${percent(pct)})`; zero cents: `$0.00 (0.0%)`, no arrow.
- Empty (no series in any month): "No spending to show yet", centred, padding 40px 8px.

**Chart card** `.st-card`: bg `--backgroundSecondary`, radius `--radius-lg`, padding 24, margin-bottom 16. Header
column (gap 16): captions 14/500 `--labelSecondary` (padding-bottom 4), average 30/700 (lh 36), total 16/600. The chart
sits 16 below.

**`IncomeExpenseReport.tsx`**:
- reads `useIncomeExpense`;
- collapse state `useState<Set<string>>`, with keys `income`, `expense`, `sources` and `g:<id>`;
- popover state as above, with `span` = the month, or the report span for Average and Total;
- `excludedCategoryIds` is set for the group and `expenses` selectors.

Markup: `<div class="ie-scroll"><table class="ie-table" style="min-width: 64px·(3+c)">` with a `<colgroup>` (first
`300/(3+c)%`, the others `100/(3+c)%`). Each section is a `<tbody>`, with 16px between them.

Styles (`income-expense.css`, with `--ie-row-line: rgba(255,255,255,.1)` at the top):
- `.ie-scroll`: overflow auto, padding-top 16. Cells: padding 8, nowrap; the last column has padding-right 16. The
  first column: ellipsis, `position: sticky; left: 0; z-index: 1`, with its row's background.
- Header: `<thead>` sticky top 0 (z 2), bg `--backgroundPrimary`, 12/500 uppercase, letter-spacing .6px, right,
  border-bottom 1px `--inputBorder`. Labels: blank, `monthLabel(m).toUpperCase()`…, `AVERAGE`, `TOTAL`.
- Section heading row: height 39, 18/600, border-bottom `--ie-row-line`, no amounts. It holds a `<button
  aria-expanded>` with a `CaretDownIcon`/`CaretRightIcon` (8×8, `--labelPrimary`), gap 8, then the label: `Income`
  `--statusPositive`, `Expense` `--labelNegative`.
- Group row (`All Income Sources`, each group): height 34, bg `--backgroundSecondary`, 14/600, padding-left 32. A
  `<button aria-expanded>` holds the label, then the caret. Collapsed, the row's cells hold the group figures.
- Item row (payee, Uncategorized Transactions, category): bg `--backgroundPrimary`.
  - Name 14/600, padding-left 32 (48 for categories, not compared), border-right 1px `--borderSubtle`.
  - Amounts 14/400, right; border-left 1px `--borderSubtle` (not on the first amount column), border-bottom
    `--ie-row-line`.
- Group total row: height 35, amounts with a border-top 1px `--inputBorder`.
- Section total row: height 34, bg `--backgroundSecondary`, name 600, amounts 400.
- Net Income: a heading row (18/600 `--labelPrimary`, border-bottom `--ie-row-line`), then the value row (height 38,
  no borders, amounts 16/600). Its label cell holds `<span class="ie-sr">Net Income by month</span>` (`.ie-sr`, new
  in this file: the usual 1px clip pattern).
  `.positive` `--statusPositive`, `.negative` `--labelNegative`, `.zero` `--labelSecondary`.
- Amount buttons: `aria-label="<row>–<COLUMN>"`, transparent, `font: inherit`, pointer,
  `:hover .amt { text-decoration: underline }`. Text `minusMoney(v)`; `.zero` (`--labelSecondary`) on zero.
- Collapsed: a section shows only its heading row, and a group only its group row.

**`spending-trends.css`** holds `--st-grid: rgba(255,255,255,.1)` and `--st-info-text: #ededf5`. Both files are
imported by their components.

## 9. End-to-end (`e2e/`)

**`support/spending-breakdown-seed.ts`** (extend; keep existing exports):
- `seedSpendingExample(request, { order?, earlyMonth? })`. `earlyMonth` adds an on-plan cash account `D8 Wallet`
  with a 10.00 Starting Balance on that date.
- `seedTrendsSplitPlan` (plan T), `seedIncomePlan` (plan I) and `seedIncomeEmptyPlan` (plan E), per the design.
- An exported `customFrom(page, from, start)`, copied from `spending-breakdown.spec.ts` (that spec keeps its own).
- `segmentPoint(page, month, series)`: a point inside the rect, checked with `elementFromPoint`.

**`spending-trends.spec.ts`**: design cases 1–8.
- Hover with `page.mouse.move` to `segmentPoint`, and click with it or `realClick`; download with `waitForEvent`.
- Read the ZIP with `python3 -I` and `zipfile` from a temp dir.
- Case 1's API figures are read with `request` (REST); MCP equality is the Worker test's.

**`income-expense.spec.ts`**: design cases 9–15.
- Locate rows by `rowheader` name and cells by their button names.
- Case 14 at 1024×700: `scrollLeft` set on `.ie-scroll`, then `realClick` on `D8 Food–TOTAL`. Assert the document's
  `scrollWidth` ≤ `clientWidth` and the dialog box is inside the window.

**`reflect-frame.spec.ts`**:
- Income v Expense now expects the `AVERAGE` column header and an enabled Export;
- the placeholder line is asserted on Age of Money;
- the last line of 548-8 expects Export enabled on Spending Trends.

All specs fix the clock with `openReport` (2026-11-15) and pass `today=2026-11-15` to the API. After a click that
sends a request, `expect.poll` the server. Wait for the last expected row before measuring.
