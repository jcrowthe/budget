# Spending Trends and Income v Expense design (EXF-550, EXF-552)

One Build, two tickets, one set of files: the Reflect pages and the Worker's reports files. Both reports sit in the
existing frame, count spending with `spendingRows`, and reuse `reports/transactions`, `TransactionPopover`,
`breakdownCsv`/`transactionsCsv` and `zip.ts`. Builds on [reflect-design.md](reflect-design.md) and
[spending-breakdown-design.md](spending-breakdown-design.md). Tasks, sizes and colours:
[trends-income-spec.md](trends-income-spec.md).

## Source

Studied live on 2026-11-16 by a sub-agent in this Thread's own source tab, on the test plan's Reflect pages only.
Notes (sizes, colours, CSS rules, action log) and 15 captures are in `/workspace/scratch/source/reflect-trends-ie/`:
- the captures are cropped to the report area (no sidebar), numbered 01–08 and 10–16 (no 09), none deleted;
- the window was 1600×813 and dark, and was never changed.

The test plan has no spending and no income. Its first month is Nov 2026, so every preset showed one month. Its only
income is a negative Manual Balance Adjustment. Seen:
- **Spending Trends** (01–08):
  - the chart card sits above the table card, both full width;
  - empty chart: one hollow marker at 0 on a dashed zero line at mid-height, x label `11/26`, no y labels;
  - the marker tooltip `Nov 2026 / $0.00 / Total Spending`; the info tooltip appears after 1.9s;
  - the stylesheet styles bars and a "net inflows" tooltip line.
- **Income v Expense** (10–16):
  - no card: the table is its own scroll box, with a sticky header and first column;
  - green `▾ Income` (`All Income Sources ▾`, the payee, two total rows) and red `▾ Expense` holding only
    `Total Expenses $0.00`: **rows with no activity are not shown**;
  - a `Net Income` heading row, then a value row with an empty label;
  - zero amounts grey; amounts underline on hover; collapse as the ticket describes.
- **Filters** (07, 08, 15, 16): the same category list on both. The account list held only closed accounts, so the
  open types offered could not be seen; `accountSections` already offers on-plan cash, credit and closed.
- **Breakpoints:** none (only `@media print`). Other window widths: not compared.
- **Differs from the ticket:** the empty text lacks "yet". We follow the ticket and the Lead's acceptance.
- **Not compared (not visible in the test plan):**
  - bars, segments, series colours and segment tooltips; the drill; the line over several months; the comparisons;
  - groups and categories in Income v Expense, sideways scrolling and "(no payee)";
  - the popovers and both exports.

## The two counting rules

**Spending** is `spendingRows` and nothing else (unchanged; see the Spending Breakdown design), filtered by
`filterRows`. No new column is needed.

**Income**, written once as `incomeRows` in `apps/worker/src/repositories/reports.ts`. An **income row** is a
non-deleted `transactions` row that meets all of these:
- it is on a non-deleted **on-plan** account of the plan (closed ones included) that is not excluded;
- its date is inside the range's months;
- it is not a **split parent** (a row with a live line); if it is a line, its parent is not deleted;
- it has `inflow_to_ready_to_assign` set, **whatever its sign**;
- it is **not a transfer** (`transfer_account_id` is null);
- its payee is not the **Starting Balance** system payee.

It is grouped by **payee**: the line's own payee when the line has one (`payee_id` or `payee_name`), else the
parent's. A balance adjustment carries the `manual_adjustment` payee and shows as "Manual Balance Adjustment",
negative when negative. A row with no payee id is listed as **"(no payee)"** with `payee_id` null; the drill-down's
sentinel for it is `none`. The category filter never applies to income; the account filter does.

## Arithmetic (milliunits, integers only; pure, in `packages/schema/src/`)

`n` = months in the range. Every Average is `centsRound(total, n)` (`spending-breakdown.ts`): cents, rounded half
away from zero.

**Spending Trends** (`spending-trends.ts`):
- A **series** is a category group, plus Uncategorized (id `uncategorized`, name "Uncategorized Transactions": a row
  with no category, or whose category has no group). While drilled (`group_id`), only that group's rows count and each
  category is a series. Hidden categories count.
- **Series amount** in a month = −Σ amount (spending positive, a net inflow negative). An amount of 0 has no segment.
- **Month total** = Σ series amounts (a net inflow lowers it). **Total** = Σ month totals; **average** =
  `centsRound(total, n)`.
- **compared_to_average** = month total − average.
- **compared_pct** = `floor((2000·|diff| + |avg|) / (2·|avg|)) / 10`, i.e. one decimal, half up; 0 when the average
  is 0.
- **share_pct** = the segment over the month's **gross spending** (the sum of its positive segments), in tenths half
  up; null for a segment ≤ 0. It equals the share of the month total whenever no segment is a net inflow (all the
  ticket's cases), and never passes 100%. Not compared.
- **Rank** (bottom-up stacking and colours): range total descending, then plan order, with Uncategorized last on a tie.

**Income v Expense** (`income-expense.ts`):
- Every row is `{ months[n], average, total }`.
- **Signs:** income is its signed sum; expenses are the signed sum of counted rows (negative); refunds net (Oct Food
  −130000).
- **Rows:**
  - a payee is listed when it has an income row;
  - Uncategorized when it has a counted row (`null` otherwise);
  - a category when it has a counted row;
  - a group when one of its categories is listed.
- **Order:** groups and categories in plan order, hidden ones in place; payees by name, case-insensitive, with
  "(no payee)" last.
- **Totals:** income total = Σ payees; expense total = uncategorized + Σ group totals; **Net Income** = income +
  expenses, per month and in total.

The unit tests take "today" and the span as inputs and reproduce every figure of both tickets' arithmetic and worked
example sections; the spec lists them.

## Interfaces

All paths are under `/api/v1/budgets/{budget_id}/reports`.
- Lists are comma-separated, and `uncategorized` is the category sentinel. `today` is optional.
- Both months, or neither: neither means **Last 3 Months** from `today`, clamped to the plan by `resolveRange`.
  Start ≤ end, and at most 1200 months.
- Unknown plan, group or payee: 404. Bad query: 422.

**`GET …/spending-trends`**
- Query: `start_month`, `end_month`, `excluded_category_ids`, `excluded_account_ids`, `group_id` (a drill), `today`.
- Returns `{ data: { start_month, end_month, group: {id,name}|null, total, average_monthly, series:[{id, name, total}],
  months:[{month, total, compared_to_average, compared_pct, series:[{id, name, amount, share_pct|null}]}] } }`.
- `series` lists every series in rank order. Months are oldest first, and their series keep that order.

**`GET …/spending-trends/export`**
- Same query; `group_id` is ignored, as in Spending Breakdown.
- Returns `application/zip`, `budget-reflect-spending-trends-<today>.zip`, holding:
  - `…-<today>.csv` = `breakdownCsv(rows, span)`;
  - `…-<today>-transactions.csv` = `transactionsCsv(rows)`.
- BOM, LF, no trailing newline. Hidden categories are under "Hidden Categories" (not compared).

**`GET …/income-expense`**
- Query: the same, without `group_id`.
- Returns `{ data: { start_month, end_month, months:[month…], income:{ payees:[{payee_id|null, name, months, average,
  total}], total:Fig }, expense:{ uncategorized:Fig|null, groups:[{id, name, categories:[{id, name, hidden, months,
  average, total}], total:Fig}], total:Fig }, net_income:Fig } }`, with `Fig = {months, average, total}`.

**`GET …/income-expense/export`**
- `text/csv; charset=utf-8`, `budget-reflect-income-expense-<today>.csv`. **No BOM**, LF, no trailing newline.
- Header `"Category","May 2026",…,"Average","Total"`; amounts via `csvAmount`.
- Rows in order:
  - `All Income Sources` (the income total; left out when there is no payee), each payee, `Total Income`;
  - `Uncategorized Transactions` when listed;
  - for each group, a row with its name holding its subtotal, then its categories;
  - `Total Expenses`, `Net Income`.

**`GET …/transactions` grows.** It takes exactly one selector: `category_id` | `group_id` | `uncategorized=true`
(unchanged), or one of the new ones:
- `income_payee_id=<payee id | none>`: one payee's income rows;
- `income=true`: every income row;
- `expenses=true`: every counted spending row.

The new `excluded_category_ids` applies to the spending selectors only. Spending Breakdown does not send it, so it
behaves as before. A payee that is not the plan's (deleted ones are the plan's): 404. Income rows have null
`category_id` and `category_name`.

**Which selector each cell uses.** A month cell sends that month as start and end. Average, Total and segments
outside a month cell send the range, and every call sends `excluded_account_ids`.

| Cell or segment | Selector |
|---|---|
| Trends: Uncategorized segment (not drilled) | `uncategorized=true` |
| Trends: group segment | none (drills) |
| Trends: category segment (drilled) | `category_id` |
| IvE: payee | `income_payee_id` (`none` for "(no payee)") |
| IvE: All Income Sources (collapsed), Total All Income Sources, Total Income | `income=true` |
| IvE: Uncategorized Transactions | `uncategorized=true` |
| IvE: category | `category_id` |
| IvE: group (collapsed), Total &lt;group&gt; | `group_id` + `excluded_category_ids` |
| IvE: Total Expenses | `expenses=true` + `excluded_category_ids` |
| IvE: Net Income | not clickable |

**MCP** (`mcp/tools/reports.ts`):
- `get_spending_trends { budget_id, start_month, end_month, group_id?, excluded_category_ids?, excluded_account_ids? }`;
- `get_income_expense { budget_id, start_month, end_month, excluded_category_ids?, excluded_account_ids? }`;
- `list_report_transactions` gains `income_payee_id?`, `income?: true`, `expenses?: true` and
  `excluded_category_ids?`.

Each description states `MONEY` and `MONTH`, the sign of each figure (Trends: spending positive and a net inflow
negative; Income v Expense: income positive and expenses negative), what is returned, and the counting rules in two
sentences each (the spec gives the wording). No timestamps are returned. Both new tools get a `CALLS` line in
`mcp-timestamps.test.ts`.

**Coverage** (`mcp-coverage/reports.ts`): the two reads map to their tools; the two exports are `excluded` lines (a
file download; the tools return the same figures).

## Screens

Sizes and colours come from the notes; the spec lists them.
- **New custom properties:** `--st-grid`, `--st-info-text`, `--ie-row-line`. All other colours map to existing tokens.
- **New icon:** `CaretRightIcon` in `reflect/icons.tsx`.
- **Series colours:** `--sb-slice-1…8` by rank, then `--sb-slice-other`.

**Spending Trends** (Export enabled). The page owns the drill as React state, so a reload resets it. The breadcrumb is
`All Groups › <group>`, and `categoryGroupId` scopes the category filter, which then reads `All Categories`.
- **Chart card:** the averages, then the app's own SVG chart, 320 high:
  - one column for **every month of the range** (empty ones included), x labels `MM/YY`;
  - y ticks from `niceTicks`, with dashed gridlines; none when all is zero, so the zero line sits at mid-height;
  - stacked bars by rank from 0 upward, with net-inflow segments stacked below 0;
  - a white line through the month totals with hollow markers.
- **Hover** (tooltip above the element):
  - a segment: `name` / `$450.00` / `100.0% of Total`;
  - a negative segment: `name` / `−$50.00` / `Net Inflows`;
  - a marker: `Nov 2026` / total / `Total Spending`.
- **Click:**
  - a group segment drills;
  - the Uncategorized segment, or a category segment while drilled, opens `TransactionPopover` for that month, titled
    `<name>–<MMM YYYY>` (en dash, upper case: `D8 Food–OCT 2026`);
  - markers and table rows do nothing.
- **Table card:**
  - rows newest first, every month: `November 2026 | $55.00 | ↓ −$80.82 (59.5%)`;
  - ↑ above zero cents, ↓ below, none at zero (`$0.00 (0.0%)`);
  - with no segment in any month: "No spending to show yet" and no rows;
  - an info button `About Compared to Average` shows the ticket's text after 1.9s.

**Income v Expense** (Export enabled):
- **Layout:** a real `<table>` in a scroll box `.ie-scroll`, so the page never scrolls sideways. The header row and
  the first column are sticky; every column is at least 64px.
- **Money:** negatives `−$120.00` (U+2212, a new `minusMoney`), zero grey. Net Income is green above zero, red below,
  grey at zero.
- **Collapse:** buttons with `aria-expanded` on `Income`, `Expense`, `All Income Sources` and each group. React state
  only; nothing is stored.
- **Amount cells** are buttons named `<row>–<COLUMN>` (`D8 Food–OCT 2026`, `D8 Food–TOTAL`). A click opens the
  popover titled `<row>–<MMM YYYY>`, or `<row>` for Average and Total. `<row>` is the visible label: `Total Expenses`,
  `Total D8 Group`, or `D8 Group` on a collapsed row.
- **Net Income:** a heading row, then a value row whose label cell holds the visually hidden `Net Income by month`.

**`TransactionPopover`** gains optional `span` and `excludedCategoryIds`. `useReportTransactions` takes the wider
selector and an optional category list.

## Downstream effects

- `reports/transactions` and `list_report_transactions` are additive; old calls behave as before.
- `newestFirst` (`spending-breakdown.ts`) widens its parameter type to the four fields it reads, so income rows sort
  the same way.
- `e2e/reflect-frame.spec.ts` stops expecting the placeholder and a disabled Export on these tabs; Age of Money keeps
  the placeholder.
- The default ranges are already Last 3 Months (`DEFAULT_PRESETS`).
- The Plaid Build's new `transactions` columns need no condition here.

## Out of scope

- Age of Money (EXF-553) and the light theme;
- storing collapse state, a legend, and keyboard access to chart segments (the table holds the same figures);
- an export of the drilled view: it exports the whole range, as Spending Breakdown does.

## Acceptance

Defaults:
- Each case makes its own plan through the API.
- The browser clock is 2026-11-15 12:00, and the API gets `today=2026-11-15`.
- The window is 1600×900 unless stated.
- Clicks and hovers use the real mouse (`realClick`).
- **Example** = the Spending Breakdown seed. For EXF-552 its categories are created in the order Hidden, Loan Pmt,
  Utilities, Fun, Food.
- **Compare** = the source's tab in this Thread's own source tab as found (dark, current window, Last 3 Months reading
  "Nov 2026", All Categories, All Accounts), changing nothing.

1. (550-1, 550-8) Example, Custom May–Nov:
   - `$135.82` and `$950.74`;
   - rows top to bottom: `November 2026 $55.00 ↓ −$80.82 (59.5%)`, `October 2026 $450.00 ↑ +$314.18 (231.3%)`,
     `September 2026 $175.24 ↑ +$39.42 (29.0%)`, `August 2026 $105.50 ↓ −$30.32 (22.3%)`,
     `July 2026 $165.00 ↑ +$29.18 (21.5%)`, then June and May `$0.00 ↓ −$135.82 (100.0%)`;
   - the API gives 950740 and 135820, and `get_spending_trends` returns an equal object.
2. (550-2, Lead 8) A fresh example opens on `Sep 2026 – Nov 2026`: `$226.75`, `$680.24`, September
   `↓ −$51.51 (22.7%)`. This Month: `$55.00` twice, and Nov `$0.00 (0.0%)` with no arrow.
3. (550-3) May–Nov, hover Oct's D8 Group segment: `D8 Group` `$450.00` `100.0% of Total`. Hover the Jun marker:
   `Jun 2026` `$0.00` `Total Spending`.
4. (550-4) Click Oct's D8 Group segment:
   - H1 `All Groups › D8 Group`, `$133.68`, `$935.74`, category button `All Categories`;
   - Oct tooltips: Food `$130.00 28.9%`, Loan Pmt `$250.00 55.6%`, Fun `$30.00 6.7%`, Hidden `$40.00 8.9%`;
   - click Oct's D8 Food segment: dialog `D8 Food–OCT 2026` with only `+$20.00` and `-$150.00`. Close works with the
     real mouse, and `All Groups` returns.
5. (550-5, 550-9) Plan **T**:
   - groups `T Needs` [T Food] and `T Wants` [T Fun]; Checking +1,000.00 Starting Balance on 10-01;
   - 11-04 a split −100.00 (T Food −60.00, T Fun −40.00); 11-06 +50.00 with no category, payee `T Refund`.
   - This Month: `T Needs $60.00 60.0% of Total`, `T Wants $40.00 40.0% of Total`.
   - The Uncategorized segment lies below the zero line: `Uncategorized Transactions` `−$50.00` `Net Inflows`.
   - Marker, average and total are all `$50.00`.
   - API series 60000, 40000, −50000; the −100.00 parent is in no segment.
6. (550-6) Empty plan:
   - `$0.00` and `$0.00`, one marker on the zero line at mid-height, x label `11/26`, no y labels;
   - the marker tooltip `Nov 2026` `$0.00` `Total Spending`; "No spending to show yet";
   - after 2s on the info button, the ticket's text.
   - **Compare** captures 01, 02, 04: layout, headings, sizes, marker, zero line, tooltip and table header. The
     empty text differs by "yet", by decision.
7. (550-7) Example May–Nov, Export → Export: `budget-reflect-spending-trends-2026-11-15.zip`.
   - `python3 -I` with zipfile lists exactly `…-2026-11-15.csv` and `…-2026-11-15-transactions.csv`;
   - the summary holds `"D8 Group","D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49`;
   - both files have a BOM, no CR and no trailing LF.
8. (550-10) Example, All Dates: x labels `05/26 06/26 07/26 08/26 09/26 10/26 11/26`, with seven markers.
9. (552-1, 552-2, 552-6) Example, Custom May–Nov:
   - every cell of the worked table, rows in order: D8 Employer, Total All Income Sources, Total Income, Uncategorized
     Transactions, D8 Hidden, D8 Loan Pmt, D8 Utilities, D8 Fun, D8 Food, Total D8 Group, Total Expenses, then Net
     Income;
   - e.g. Oct Food `−$130.00`, and Net Income `$1,578.47` and `$11,049.26` in green;
   - no `Starting Balance`, `Transfer`, `$500.00` or `$2,000.00` on the page;
   - the API gives `net_income.total` 11049260, and `get_income_expense` returns an equal object.
10. (552-3) Collapse D8 Group:
    - its row shows `−$165.00` (Jul) … `−$935.74` (Total), and hides `Total D8 Group` and D8 Food. Expand.
    - Collapse Expense: no expense row and no `Total Expenses`; Net Income stays. Expand.
    - The same for Income, and for All Income Sources (its row shows `$12,000.00`).
11. (552-4) Click Oct D8 Food: dialog `D8 Food–OCT 2026` with `+$20.00` and `-$150.00`.
    - D8 Food's Total: dialog `D8 Food` with 6 rows.
    - `Total Income–OCT 2026`: `D8 Employer` `+$3,000.00`.
    - `Total Expenses–OCT 2026`: 5 rows.
12. (552-5) Export → Export: `budget-reflect-income-expense-2026-11-15.csv`, with no BOM, no CR and no trailing LF,
    equal byte for byte to the 13 lines listed in the spec (task 2), which hold
    `"D8 Group",0.00,0.00,-165.00,-105.50,-160.24,-450.00,-55.00,-133.68,-935.74` and
    `"Net Income",0.00,0.00,2835.00,2894.50,2824.76,2550.00,-55.00,1578.47,11049.26`.
13. (552-7) Plan **I**, This Month:
    - Checking (+1,000.00 Starting Balance on 10-01) and Loan (tracking);
    - 11-02 a split +80.00 (payee `I Parent`) with lines +50.00 to RTA (no own payee) and +30.00 to RTA (payee
      `I Line Payer`);
    - 11-03 a +100.00 transfer from Loan, to RTA; 11-05 +10.00 to RTA with no payee;
    - then Checking's balance adjusted down by 250.00 (`today` 2026-11-15).
    - Expected income rows: `I Line Payer $30.00`, `I Parent $50.00`, `Manual Balance Adjustment −$250.00`,
      `(no payee) $10.00`; Total Income `−$160.00`.
    - No `$1,000.00`, `$80.00` or `$100.00` on the page.
    - `Manual Balance Adjustment–NOV 2026` lists the −250.00 row; `(no payee)` uses `income_payee_id=none`.
14. (552-9) Example plus a Starting Balance on 2025-12-01, at 1024×700, Last 12 Months:
    - the table box scrolls sideways (scrollWidth > clientWidth) and the document does not;
    - with the box scrolled to its end, the `D8 Food` label keeps its x;
    - the real mouse clicks `D8 Food–TOTAL`, which opens dialog `D8 Food` inside the window.
15. (552 empty) Plan **E**: Checking with a +100.00 Starting Balance on 11-01, then its balance adjusted to 50.00.
    - Green `Income`, `All Income Sources`, `Manual Balance Adjustment −$50.00`, `Total All Income Sources`,
      `Total Income`.
    - Red `Expense` with only `Total Expenses $0.00`, in grey.
    - A red Net Income of `−$50.00`; collapse works as in case 10.
    - **Compare** captures 10 and 12–14: header, colours, row backgrounds, borders, carets and collapse.
16. (Lead 8, Worker) Example, Jun–Nov and May–Nov, unfiltered and with Uncategorized and D8 Savings excluded:
    IvE `expense.total` = −Spending Breakdown `total` = −Trends `total`. This holds while no category nets to an
    inflow over the range, because Spending Breakdown lists only net spending; the example has none.
17. (Lead 9, Worker) Example with D8 Checking closed (as the Net Worth test does): Spending Breakdown Jul 2026 is
    165000 with it selected, and 0 with it excluded.
18. (Worker) `reports/transactions`:
    - two selectors, or none: 422;
    - another plan's payee: 404;
    - `expenses=true` May–Nov: 13 rows;
    - `income=true`: the four D8 Employer rows;
    - `group_id` with D8 Food excluded: no Food row.

## Manifest

touches: [packages/schema/src/reports.ts, packages/schema/src/spending-trends.ts, packages/schema/src/income-expense.ts, packages/schema/src/reflect-format.ts, packages/schema/src/spending-breakdown.ts, packages/schema/test/spending-trends.test.ts, packages/schema/test/income-expense.test.ts, packages/schema/test/reflect-format.test.ts, apps/worker/src/repositories/reports.ts, apps/worker/src/services/reports.ts, apps/worker/src/routes/reports.ts, apps/worker/src/mcp/tools/reports.ts, apps/worker/test/spending-trends.test.ts, apps/worker/test/income-expense.test.ts, apps/worker/test/report-example.ts, apps/worker/test/spending-breakdown.test.ts, apps/worker/test/mcp-coverage/reports.ts, apps/worker/test/mcp-timestamps.test.ts, apps/web/src/reflect/**, apps/web/src/pages/reflect.tsx, apps/web/src/api/reports.ts, e2e/reflect-frame.spec.ts, e2e/spending-trends.spec.ts, e2e/income-expense.spec.ts, e2e/support/spending-breakdown-seed.ts, docs/trends-income-design.md, docs/trends-income-spec.md, docs/README.md]
shared: []
migrations: 0
