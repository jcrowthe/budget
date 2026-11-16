# Spending Breakdown design (EXF-549, EXF-548 drill-down, EXF-588, EXF-591)

One Build, four tickets, one set of files. EXF-549 is the Spending Breakdown report. From EXF-548 only its last open
part is built here: the transaction drill-down popover and `GET …/reports/transactions`. EXF-588 and EXF-591 are
follow-ups to Net Worth and the Reflect frame. Builds on [reflect-design.md](reflect-design.md) and
[transfers-splits-design.md](transfers-splits-design.md). Tasks: [spending-breakdown-spec.md](spending-breakdown-spec.md).

## Source

Studied live on 2026-11-16 in this Thread's own source tab, on the test plan's Reflect pages only. Notes, CSS rules and
12 captures (cropped, no sidebar) are in `/workspace/scratch/source/spending-breakdown/`: `notes.md`, `css-rules.txt`
and `01-default.png` … `12-nw-account-filter.png`. The window was 1600×813 and the theme dark.

The test plan has **no spending in any month**, so only the empty state was seen live. Sizes and colours used below
come from the notes:
- **Layout:** `#15172d` cards (radius 8, padding 24); a donut with R ≈ 0.375 of a 1.3:1 box and inner radius 0.6 R;
  a 226×32 toggle.
- **Empty state** (captures 01, 02, 08): an off-white `#f8f6f2` ring, `$0.00`, metrics `$0.00 $0.00 n/a n/a`, list
  header following the toggle.
- **Stylesheet only:** row hover `#7583ff33` with text `#a3acff`; bars 16px, radius 4; other slices dim to 0.4; the
  breadcrumb "All Groups ›" sits in the page header.
- **Date menu and filter popovers** (03, 06, 11, 12):
  - the date menu is 240 wide, centred on the label button, top = bottom + 15, drawn above the sidebar;
  - filter popovers are 450 wide, max height 424, with the list scrolling inside 304px.
- **Net Worth Debts** reads `-$0.00` in the source; EXF-591 (Lead) overrides that.
- **Not visible:** slices, colours, labels, rows, hover, the popover, the drill, splits, and the callout.
- **Differs from the ticket:** the source's empty list said "No spending to show" with no callout. We follow the
  ticket.

## The spending rule (note 1)

In words: a **counted row** is a non-deleted `transactions` row that meets all of these:
- it is on a non-deleted **on-plan** account of the plan that is not excluded;
- its date is inside the range's months;
- it is not a **split parent** (a row with a live line);
- if it is a split **line**, its parent is not deleted;
- it is not a **transfer whose other account is on-plan**;
- it is not flagged **inflow to Ready to Assign**;
- its payee is not the **Starting Balance** system payee.

A counted row belongs to its own `category_id`, or to **Uncategorized** when that is null. Its spending is
`−amount`, so refunds reduce a category. Hidden categories count. A deleted category's rows count under whatever
category they carry now. Rows of an excluded category (or of `"uncategorized"`) are then dropped.

So a split's lines count once each in their own categories, and a transfer from an on-plan account to a tracking or
loan account counts in its category, or as Uncategorized.

Written once as `spendingRows` in `apps/worker/src/repositories/reports.ts`, an SQL query that reuses nothing from
`repositories/transactions.ts`. The service and the pure module apply the category filter.

## Approach

- **Pure modules in `packages/schema/src/`**, unit-tested by the unit project. Web unit tests are not collected, and
  `vitest.config.ts` is always-overlap.
  - `spending-breakdown.ts`: the arithmetic and both CSVs; "today" and the span are inputs.
  - `zip.ts`: a store-only ZIP writer (CRC-32, local headers, central directory, end record). No new dependency.
  - `reflect-format.ts`: money with no negative zero, `niceTicks`, the drill-down amount and date.
    `apps/web/src/reflect/format.ts` re-exports it.
- **One service** (`services/reports.ts`) feeds REST, MCP and the ZIP.
- **The web.** The Spending Breakdown tab gets its own page component, holding the toggle and drill state as React
  state; a reload or another plan resets it. `ReportFrame` gains two optional props: `heading` (the breadcrumb) and
  `categoryGroupId` (the filter's scope while drilled).

## Arithmetic (milliunits, integers only)

- `months` = months in the range; `days` = the sum of their calendar days (the current month counts in full).
- **Items:**
  - Categories mode: one per category with counted rows, plus Uncategorized. `total` = −Σ amount.
  - Groups mode: one per real group (hidden categories included), plus Uncategorized.
  - A drill (`group_id`) keeps only that group's rows, then builds items by category.
  - **Listed** = `total > 0`; a category that nets to an inflow is off the screen (the source's inflows card is not
    cloned).
  - Total = the sum of listed items. Rank: total descending, then plan order, Uncategorized last.
  - `share_pct` = `floor((200·item + total) / (2·total))`, i.e. round half up.
- **Averages:** `average_monthly` = total ÷ months and `average_daily` = total ÷ days, each rounded half away from zero
  to whole cents (a multiple of 10 milliunits).
- **`most_frequent`:**
  - the listed item with the most counted rows; refunds count and a split line is one row;
  - ties go to the larger total, then rank;
  - `null` when there is no listed item.
- **`largest_outflow`:**
  - the counted row with the most negative amount; ties go to the newer date, then id;
  - `transaction_id` is the row's id, or the parent's for a line;
  - `payee_name` is the line's payee, else the parent's; a transfer reads `Transfer : <other account>`;
  - `amount` is positive;
  - `null` when there is no outflow.
- **Ticket figures, all reproduced in unit tests:**
  - Jun–Nov: 950740; 51/26/11/6/4/2; 158460 and 5200;
  - May–Nov: 135820 and 4440; Sep–Nov: 226750 and 7480; Nov: 55000 and 1830;
  - Groups: 98 and 2; Food 6 rows; D8 Group 12 rows;
  - drill: 935740, Food 52 and Loan Pmt 27, 155960 and 5110.

**Split case** (Lead; not compared: splits are not visible in the test plan). Plan **S**, Nov 2026, today 2026-11-15.
Checking has a Starting Balance of +1,000.00 on 10-01.
Rows: 11-04 split A (parent −100.00, payee `S Market`): Food −60.00, Fun −40.00 · 11-06 split B (parent −30.00, payee
`S Shop`): Food −20.00 memo `line memo`, no category −10.00 line payee `S Line Payee` · 11-07 transfer −200.00 to
on-plan Savings · 11-08 plain Food −15.00 · 11-09 transfer −55.00, no category, to tracking `S Loan`.

Expected:
- Food 95.00 48%; Uncategorized 65.00 33%; Fun 40.00 20%; total 200.00.
- Most Frequent: Food, 3 transactions.
- Largest Outflow: `S Market` 60.00 (the line, not the −100.00 parent).
- The −200.00 transfer counts nowhere.

## Interfaces

All paths are under `/api/v1/budgets/{budget_id}/reports`. Lists are comma-separated; `"uncategorized"` is the
sentinel, as the filter stores it. Unknown plan: 404. Bad query: 422.

**`GET …/spending-breakdown`**

Query:
- `start_month` and `end_month` (both or neither; neither = This Month from `today`; start ≤ end; ≤ 1200 months);
- `excluded_category_ids`, `excluded_account_ids`;
- `group_by` = `category` (default) or `group`;
- `group_id` (a drill: a group of the plan, else 404; `group_by` is then ignored);
- `today`.

Returns `{ data: { start_month, end_month, months, days, group_by, group: {id,name}|null, total, average_monthly,
average_daily, most_frequent: {id,name,transaction_count}|null, largest_outflow: {transaction_id,payee_name,amount}|null,
items: [{id, name, group_name, total, share_pct, transaction_count}] } }`. Spending is positive. `group_name` is null
for groups and for Uncategorized.

**`GET …/spending-breakdown/export`**

- Takes the same query; `group_by` and `group_id` are ignored, so every mode exports the same.
- Returns `application/zip` with `attachment; filename="budget-reflect-spending-breakdown-<today>.zip"`.
- The archive holds `…-<today>.csv` and `…-<today>-transactions.csv`. `today` = the query's `today`, else the Worker's
  UTC date. Entry times are that date at 00:00.

**`GET …/transactions`** (EXF-548)

Query: `start_month`, `end_month` (required), exactly one of `category_id` | `group_id` | `uncategorized=true` (else
422), and `excluded_account_ids`. A category or group that is not the plan's (deleted ones included) gives 404.

Returns `{ data: { transactions } }`: the counted rows of the selection, newest first (date, created_at desc, then
split_index, id). Each row has:
- `transaction_id` (the parent's for a line), `subtransaction_id` (null unless a line);
- `account_id`, `account_name`, `date`;
- `payee_name` (a transfer: `Transfer : X`; a line: its own payee, else the parent's);
- `memo` (the line's own);
- `amount` (signed, outflow negative);
- `category_id`, `category_name`, `cleared` (a line takes its parent's).

`income_payee_id` is left to Income v Expense (EXF-552).

**MCP** (`mcp/tools/reports.ts`):
- `get_spending_breakdown { budget_id, start_month, end_month, group_by?, group_id?, excluded_category_ids?,
  excluded_account_ids? }`.
- `list_report_transactions { budget_id, start_month, end_month, category_id?, group_id?, uncategorized?,
  excluded_account_ids? }`.
- Both descriptions state:
  - milliunits (1000 = one currency unit);
  - that spending figures are positive while a transaction's `amount` is signed, outflow negative;
  - `YYYY-MM-01` months and `YYYY-MM-DD` dates (no timestamps are returned);
  - what is returned;
  - the rule in two sentences: "Spending counts rows of on-plan accounts in the range: split lines in their own
    categories (never the split parent) and transfers to tracking accounts. Transfers between two on-plan accounts,
    inflows to Ready to Assign and Starting Balances never count; a row with no category is Uncategorized."

Coverage lines in `apps/worker/test/mcp-coverage/reports.ts`:
- `…/spending-breakdown` → `get_spending_breakdown`;
- `…/transactions` → `list_report_transactions`;
- `…/spending-breakdown/export` → excluded: "a ZIP file download of two CSVs; get_spending_breakdown and
  list_report_transactions return the same figures".

## Export CSVs (UTF-8 with BOM, LF, no trailing newline; strings quoted, `"` doubled)

**Summary CSV**
- Header: `"Category Group","Category","Jun 2026",…,"Average","Total"`.
- One row per category with a counted row in the range: visible categories in plan order, then hidden ones (the
  category or its group hidden) in plan order with group `"Hidden Categories"` (not compared), then
  `"","Uncategorized"`.
- Amounts are signed (spending negative), via `csvAmount` from `net-worth.ts` (never `-0.00`).
- Average = Total ÷ months, cents rounded half away from zero (`-80.92`).

**Transactions CSV**
- The ticket's header; one row per counted row (a line is one row), newest first.
- Flag is always empty (no flags yet). Date is `MM/DD/YYYY`.
- Hidden: `"Hidden Categories: X","Hidden Categories","X"`. Uncategorized: three empty fields.
- Outflow and Inflow are non-negative and unquoted, as `$` with 2 decimals and **no thousands separator** (a comma
  would split the field; not compared).
- Cleared is `Cleared` for cleared or reconciled, else `Uncleared`.

## Screen

`/:budgetId/reflect/spending-breakdown`; the title is unchanged. Export is enabled (the existing dialog). Tokens are
used where they exist; colours and sizes come from the notes.

- **Layout:** a row with gap 16. Left (flex 2): the donut card, then the metrics card. Right (flex 1): the list card,
  as tall as the left column, with a body that scrolls. Below a 1280px window the columns stack.
- **Donut card**
  - Header: "Total Spending" with the 30/700 amount; on the right the segmented control (`role="radiogroup"` "Breakdown
    by", radios `Categories` and `Groups`), absent while drilled.
  - Donut (own SVG):
    - W = card width, H = clamp(W/1.3, 464, 960), R = 0.375 H, r = 0.6 R;
    - slices run clockwise from 12 o'clock in list order, with a 3px `--backgroundSecondary` stroke;
    - one item is a full ring; empty is a full `--sb-empty-ring` ring;
    - the hovered slice grows to 1.03 R and the others go to opacity 0.4.
  - **Outside labels** only for `share_pct ≥ 10` (the threshold sits between the ticket's 6%, unlabelled, and 11%,
    labelled): placed at R + 28 on the mid-angle, start-anchored on the right half and end-anchored on the left.
    Line 1 is the name (14/600 primary), line 2 is `$485.49 (51%)` (14/500 secondary). No leader line.
  - **Centre:** `Total Spending` / amount; while hovering a slice: name / amount / `26%`.
  - The callout "Your spending breakdown will appear once you start recording your spending." sits under the donut
    when total = 0 and a category is selected.
- **Metrics card:**
  - Average Monthly Spending and Average Daily Spending;
  - Most Frequent Category (**Most Frequent Group** in Groups mode, not drilled): name, then `6 transactions` /
    `1 transaction`;
  - Largest Outflow: payee, then amount;
  - empty: `$0.00 $0.00 n/a n/a`.
- **List card:**
  - Header `Categories` (or `Groups`) | `Total Spending`.
  - Rows are buttons named `<name> <amount> <pct>%`: name and amount, a bar (width = share, minimum 2px, the slice
    colour), and the percent.
  - Hover or focus: `--buttonSecondaryBackground` with `--labelAction` text.
  - Empty: "No spending to show yet"; with no listed category selected, "No spending to show" and no callout.
- **Clicks** on a slice or a row:
  - Categories mode, or drilled: opens the popover;
  - Groups mode: drills;
  - Uncategorized in Groups mode: opens the popover (not compared).
- **Drill:**
  - H1 is `All Groups › <group>`: a button "All Groups" (`--labelAction`), a text `›` (`--labelTertiary`), the name.
  - Data is read with `group_id`.
  - The category button lists only that group's categories, so it reads `All Categories`; Done works as before.
  - "All Groups" returns with Groups mode kept.
- **Popover** (`TransactionPopover`, portal, `role="dialog"` named by the category or "Uncategorized"):
  - Position: the arrow points at the click point (keyboard: the row centre). It sits below the point when 240px fit,
    else above, clamped 8px inside the window. Width is min(720, window − 16).
  - Table:
    - columns `ACCOUNT DATE PAYEE MEMO AMOUNT` with a sticky header;
    - rows newest first, `10/21/2026`, `-$150.00` and `+$20.00`;
    - the body scrolls within min(400, the room left).
  - **Close** button, Escape, or an outside click closes it. A row click (or Enter) opens
    `/<plan>/accounts/<account_id>`.
- **Slice colours** (custom properties at the top of `spending-breakdown.css`; the eight-slot palette passes the
  CVD-separation and 3:1 contrast checks against `#15172d`):
  - `--sb-slice-1` `#3987e5`, `-2` `#d95926`, `-3` `#199e70`, `-4` `#c98500`, `-5` `#d55181`, `-6` `#008300`, `-7`
    `#9085e9`, `-8` `#e66767`;
  - `--sb-slice-other` `#727484` for ranks 9 and beyond;
  - `--sb-empty-ring` `#f8f6f2`.
  - Colours go by rank (the source's own colours could not be seen). **No new icons.**

## EXF-588 and EXF-591

- **Placeholders:** `useNetWorth`, `useSpendingBreakdown` and `useReportTransactions` use `keepPreviousInPlan(budgetId)`;
  `keepPreviousData` leaves `api/reports.ts`. `ReflectPage` keys the report by plan and slug.
- **`niceTicks`** moves to `reflect-format.ts`:
  - the step is never below one dollar, so labels and keys are distinct;
  - all zero gives `[]`; under one dollar gives `[0, 1000]` (negative: `[-1000, 0]`);
  - at most 5 ticks.
  - **The example data draws 4 ticks** (`$0 $10,000 $20,000 $30,000`). That is what is built; `reflect-design.md` is
    corrected.
- **Category popover:** the list caps at 304px with `overflow-y: scroll`, or less when the window leaves less room
  (minimum 120). It stays 450 wide (the source measured 450), centred on its button.
- **Date menu:** a fixed-position portal above the sidebar, centred on the label button, top = bottom + 15, 240 wide,
  clamped 8px inside the window, with the arrow on the label centre.
- **EXF-591:**
  - every Reflect money string goes through `reportMoney` (cents rounded half away from zero; 0 cents is `$0.00`);
  - `debtsMoney(0)` and `debtsMoney(-0)` are `$0.00`, while −4750000 is `-$4,750.00`;
  - `signedChange`, the tooltip, the table, the ticks and the new report never print `-$0.00` or `-$0`.

## Downstream effects

Spending Trends and Income v Expense reuse `reports/transactions`, `TransactionPopover`, `spendingRows` and
`reportMoney`; Income v Expense adds `income_payee_id`. The new `ReportFrame` props are optional.

## Out of scope

`income_payee_id`; the other three report bodies (unchanged); the positive-inflows card; flags; the light theme; Share
Your Progress. `monthlySums` is unchanged unless the other Build's balance condition is on main at rebase.

## Carry-over (2026-11-16, merged onto main `4da55a7`)

The design is unchanged; it was merged from `41f818e` onto main, which gained only targets on the Plan page. Two
points changed:
- **`localToday`.** `ReportFrame.tsx` imports it from `../api/today` (main's home for it), not `../api/accounts`.
  The behaviour is the same.
- **What protects a plan change (Lead, point 1).** `ReflectPage` keys the report by `${budgetId}:${report}`, so a
  change of plan remounts it with fresh query observers. A new observer has no previous data, so **the remount is
  the first guard**. That is why the 588-1 specs (case 12) also pass with the old `keepPreviousData`: they prove the
  outcome, not the option. **`keepPreviousInPlan` is the second guard**, for any plan-scoped query whose observer
  survives a plan change. No route in the app changes plan without that remount, so no browser spec can fail on the
  option alone.
  - The option gets a unit test instead. Its pure body moves to `packages/schema/src/placeholder.ts`, the same
    pattern as `reflect-format.ts`, and `apps/web/src/api/placeholder.ts` re-exports it unchanged for every caller.
  - Case 17 covers it. The same option serves `useNetWorth`, `useSpendingBreakdown` and `useReportTransactions`.
- `monthlySums` stays as it is: the other Build's balance condition is not on main.

## Acceptance

Defaults:
- Each case uses a new plan made through the API.
- Browser clock 2026-11-15 12:00 local; the API gets `today=2026-11-15`.
- Real mouse (point, `elementFromPoint` check, `page.mouse`) at 1600×900 and 1024×700.
- **Example** = the EXF-549 table (transfers as transfer pairs; D8 Car Loan `otherLiability`; D8 Hidden hidden after
  its row is entered). **S** = the split case.
- **Compare** = the source's Spending Breakdown tab of the test plan, in this Thread's own source tab, as it is (dark,
  current window, empty), with nothing changed. Anything else: "not compared: not visible in the test plan".

1. (549-1, 549-9) Example, Custom Jun–Nov:
   - total and centre `$950.74`;
   - rows in order: D8 Food `$485.49 51%`, D8 Loan Pmt `$250.00 26%`, D8 Fun `$100.00 11%`, D8 Utilities `$60.25 6%`,
     D8 Hidden `$40.00 4%`, Uncategorized `$15.00 2%`;
   - outside labels on the first three slices only;
   - metrics `$158.46`, `$5.20`, `D8 Food` `6 transactions`, `Transfer : D8 Car Loan` `$250.00`;
   - API `total` 950740, and MCP `get_spending_breakdown` returns an equal object.
2. (549-2) May–Nov: `$135.82` and `$4.44`. Sep–Nov: `$226.75` and `$7.48`. This Month: `$55.00` and `$1.83`.
3. (549-3) Groups: list header `Groups`; D8 Group `$935.74 98%`, Uncategorized `$15.00 2%`; `Most Frequent Group`
   `12 transactions`.
4. (549-4) Groups, click the D8 Group slice:
   - H1 `All Groups › D8 Group`, no toggle, `$935.74`, `$155.96`, `$5.11`, Food `52%`, Loan Pmt `27%`;
   - the category button reads `All Categories` and lists only the 5 D8 categories (closed with Cancel);
   - All Groups returns, still in Groups mode;
   - after a reload the toggle is on Categories.
5. (549-5, 548-9) Click the D8 Food row, then its slice:
   - a dialog `D8 Food` with 6 rows, newest first: `11/03/2026` `-$55.00` … `10/21/2026` `+$20.00` `refund` …
     `07/10/2026` `-$120.00` `weekly shop`;
   - inside the window at 1024×700, and Close works with a real mouse;
   - a row click opens `/<plan>/accounts/<D8 Checking id>`.
6. (549-6) Hover the Loan Pmt slice: centre `D8 Loan Pmt` `$250.00` `26%`, the other slices at opacity 0.4; leaving
   restores. A hovered row has the `--buttonSecondaryBackground` bg.
7. (549-7) An empty plan:
   - ring `rgb(248, 246, 242)`, centre `Total Spending` `$0.00`, the callout, `$0.00 $0.00 n/a n/a`, "No spending to
     show yet";
   - Select None → Done: "No spending to show", no callout.
   - Compare: source captures 01, 02, 08 (layout, ring, metrics, list header).
8. (549-8) Example Jun–Nov, Export → dialog → Export: download `budget-reflect-spending-breakdown-2026-11-15.zip`.
   - `python3 -I` with zipfile lists exactly the two CSV names;
   - the summary holds `"D8 Group","D8 Food",0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-80.92,-485.49` and ends with
     `"","Uncategorized",0.00,0.00,0.00,-15.00,0.00,0.00,-2.50,-15.00`;
   - the transactions CSV holds the ticket's Loan Pmt line and `"Hidden Categories: D8 Hidden"`;
   - both files start with a BOM, have no CR and no trailing LF.
9. (Lead 10) S, This Month:
   - screen, API and MCP: Food `$95.00 48%`, Uncategorized `$65.00 33%`, Fun `$40.00 20%`, total `$200.00`; Food 3
     transactions; Largest Outflow `S Market` `$60.00`;
   - Food popover: `-$15.00`, `-$20.00` `line memo`, `-$60.00` `S Market`;
   - Uncategorized popover: `Transfer : S Loan` `-$55.00`, `S Line Payee` `-$10.00`;
   - transactions CSV: 6 rows, no `100.00`; summary CSV Food total `-95.00`.
10. (Lead 11) S: no `$200.00` row and no `Transfer : Savings` anywhere (screen, popovers, `list_report_transactions`,
    CSVs).
11. (548) `reports/transactions` with two selectors, or none: 422. With another plan's category: 404. With Checking
    excluded: `[]`.
12. (588-1) X's Net Worth with the example, then a client-side navigation (`history.pushState` + `popstate`) to Y's
    Net Worth with Y's read held 2s: none of `$19,299.26`, `$24,049.26` or X's table rows shows during the hold; Y's
    figures show after. The same on Spending Breakdown (`$950.74`, X's rows).
13. (588-2) Inside X, change the range with the read delayed 1s: X's previous rows stay until the new ones arrive.
14. (588-3) Only balance $0.40: y labels are distinct (`$0`, `$1`).
15. (588-4) 12 extra categories:
    - at 1600×900 and 1024×700 the category popover is 450 wide (or window − 16);
    - its list clientHeight is ≤ 304 and below its scrollHeight; the popover's bottom is inside the window;
    - the wheel scrolls the list;
    - date menu: centre = label centre ±1, top = label bottom + 15, width 240.
    - Compare: source captures 03, 06, 11.
16. (591) Example, untick D8 Car Loan → Done: Debts `$0.00`, the Nov tooltip Debts `$0.00`, no `-$0.00` on the page.
    With the loan: `-$4,750.00`. An empty plan: Debts `$0.00`.
17. (588-1, Lead 1) Unit, `packages/schema/test/placeholder.test.ts`, calling `keepPreviousInPlan("Y")` directly:
    - with previous data and a previous key `["net-worth", "X", …]` it returns `undefined`;
    - with a previous key `["spending-breakdown", "Y", …]` and `["report-transactions", "Y", …]` it returns the
      previous data;
    - with no previous query it returns `undefined`.
    - Counter-check: TanStack's `keepPreviousData` is `(prev) => prev`, which returns the previous data in the first
      sub-case. A body that keeps across plans fails this test.
    - `grep -rn keepPreviousData apps/web/src/api/reports.ts` prints nothing.

## Manifest

touches: [packages/schema/src/reports.ts, packages/schema/src/spending-breakdown.ts, packages/schema/src/zip.ts, packages/schema/src/reflect-format.ts, packages/schema/test/spending-breakdown.test.ts, packages/schema/test/zip.test.ts, packages/schema/test/reflect-format.test.ts, packages/schema/src/placeholder.ts, packages/schema/test/placeholder.test.ts, apps/web/src/api/placeholder.ts, apps/worker/src/repositories/reports.ts, apps/worker/src/services/reports.ts, apps/worker/src/routes/reports.ts, apps/worker/src/mcp/tools/reports.ts, apps/worker/test/spending-breakdown.test.ts, apps/worker/test/mcp-coverage/reports.ts, apps/web/src/reflect/**, apps/web/src/pages/reflect.tsx, apps/web/src/api/reports.ts, e2e/reflect-frame.spec.ts, e2e/net-worth.spec.ts, e2e/spending-breakdown.spec.ts, e2e/reflect-followups.spec.ts, e2e/support/spending-breakdown-seed.ts, docs/spending-breakdown-*.md, docs/reflect-design.md, docs/README.md]
shared: []
migrations: 0
