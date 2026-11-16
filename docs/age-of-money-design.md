# Age of Money design (EXF-553) and the Spending Trends marker (EXF-615)

One Build, two tickets, one set of files: the Reflect pages and the Worker's reports files. This builds on
[reflect-design.md](reflect-design.md), [spending-breakdown-design.md](spending-breakdown-design.md) and
[trends-income-design.md](trends-income-design.md). The tasks are in [age-of-money-spec.md](age-of-money-spec.md).
Cases name their ticket: `553-n` is EXF-553 and `615-n` is EXF-615.

## Source

A sub-agent studied the source live on 2026-11-16, in this Thread's own source tab and only on the test plan's
Reflect pages. Its notes (DOM, computed styles, the stylesheet's rules for the populated chart, the action log) and
its single capture are in `/workspace/scratch/source/age-of-money/`:
- `notes.md`;
- `aom-initial.png`. This was a plain `page.screenshot` (no clip) at 1600×813, cropped afterwards with pngjs to the
  report area (x 260–1600, y 0–530, so no sidebar). The raw capture `raw-aom-initial.png` was deleted after cropping.
  No other capture was taken.

What it opened and pressed: it went (`page.goto` in that tab) to `/reflect/age-of-money`, then
`/reflect/spending-trends`, then `/reflect/age-of-money` again. The mouse moved only to (1500,780) and (1500,790),
below the content. It made no click, typed nothing and pressed no key. It saved nothing and changed neither the
theme nor the tab's size (1600×813 before and after). It opened neither the plan menu, nor Bank Connections, nor
Add Account, nor an account, nor another plan.

**What the source shows.** The test plan's Age of Money is in its **empty state**:
- the header is the title only, with an empty actions area: no range, no filters, no Export;
- a chart card (`#15172d`, radius 8, padding 46px 24px) holding a centred callout:
  - max width 374, padding 16, radius 8, background `rgba(60,62,83,.6)`, white text centred;
  - the heading `Spend more money!` at 18/600;
  - the text "Strange advice, we know. <source name> needs a minimum of 10 transactions to calculate your Age of
    Money." at 14/500;
  - no "Current" is shown;
- 16px below, a full-width info card:
  - `h2` "Understanding Age of Money" at 14/600 in `#f1f1ff`, padding 16, bottom border `rgba(255,255,255,.08)`;
  - then the ticket's two paragraphs at 14/500 in `#c4c5cf`, padding 16, `p` margin 14px 0;
  - no icon.
- No media query touches these cards.

**The populated chart: style rules only.** These come from the stylesheet; the chart itself was never seen:
- line 4px in `#f1f1ff`;
- markers are a solid `#f1f1ff` dot with an 8px ring of `rgba(255,255,255,.149)`. The radius is set in script, so it
  is unknown;
- the hovered point fills `#93d53e`, and a dashed (2,2) green vertical guide line marks its month;
- the y gridlines are dashed (2,2) in `rgba(255,255,255,.102)`. There is no y-axis line; the x-axis line is dashed;
- ticks are 12/500 in `#c4c5cf`;
- the hover target is the chart library's per-x event area, which suggests a column per month;
- the tooltip:
  - background `#1f2038`, radius 4, padding 16, max width 160, min height 64, the shadow
    `0 10px 20px rgba(0,0,0,.15), 0 3px 6px rgba(0,0,0,.1)`;
  - a 15px arrow at the top centre, so the tooltip sits **below** the point;
  - the month at 14/500 secondary, then the value at 18/600 primary;
- "Current": the label at 14/500 secondary (padding-bottom 4), the value at 30/700 primary;
- the top row also holds a segmented control on the right, whose labels are unknown.

**Spending Trends marker** (live, read only): r=5, fill `#0c0d22`, stroke white 2px, pointer cursor.

**Not compared** (not visible inside this Build's limits):
- the populated chart's geometry, the area fill colour, the marker radius, the tick values, the two-line x labels,
  the tooltip text, the "Current" value, and whether hover is per column;
- the segmented control. It is left out (out of scope);
- the light theme.

## The definition (decided by the Lead; not compared)

The ticket's definition, made exact by the Lead. Each line below is **decided by the Lead; not compared**:
- **Accounts (the set).** Accounts of the plan that are not deleted, on-plan (`on_budget = 1`) and of a **cash** type
  (`accountGroup(type) === "cash"`: checking, savings, cash). Closed accounts are included. Credit, loan and
  tracking accounts are outside.
- **Rows.** Rows on accounts of the set that count in a balance (`countsInBalance()`: not deleted and not a split
  line, so a split counts once, as its parent), dated on or before `today`. A row of amount 0 is neither an inflow
  nor an outflow.
- **Ignored on both sides.** A transfer whose `transfer_account_id` is an account of the set.
- **Buckets.** Every remaining positive row opens a bucket of its amount, dated by its date. This includes Starting
  Balances, income, a refund into a category, and a transfer in from outside the set.
- **Outflows.** Every remaining negative row, including a payment or transfer to a credit, loan or tracking account.
- **Order.** By date, then creation time, then id. Within one date the inflows come first, so money that arrives on
  a day can pay that day's outflows (age 0). *(The within-a-day rule is the Architect's precision of the Lead's
  "ties by creation time"; not compared.)*
- **First in, first out.** An outflow takes from the oldest bucket that still has money. Its **age** is the
  amount-weighted average of `days(bucket date → outflow date)` over the parts it takes. If the buckets run out, the
  uncovered part has age 0 and still weighs in the average. A deficit is not carried forward, so later buckets open
  full *(Architect's precision; not compared)*.
- **The value on a date** is the simple mean of the ages of the last 10 outflows dated on or before that date,
  rounded half up to whole days. With fewer than 10 outflows there is no value.
- **Months.** The chart runs from the month of the 10th outflow to the month of `today`. A month's point is the value
  at the end of that month; for the current month it is the value as of `today`. A month with no new outflow
  repeats the previous value. `current_days` is the last point's value, or null when there is no point.

**Worked example** (ticket):
- the ages are 56, 68, 82, 97, 111, 120, 128, 125.69, 128, 130 and 146;
- the 10th outflow is on 10-09, so the chart starts in Oct 2026;
- at the end of October the value is 113.57, which rounds to **114**.

The D8 example plan used by the Reflect tests (`examplePlan` / `seedSpendingExample`) is that example plus four
rows:
- a 09-01 transfer Checking→Savings, ignored;
- a 10-21 refund of +20.00, a bucket with no effect;
- a 10-25 outflow of 40.00, already in the example;
- an **11-03 outflow of 55.00**, aged 155 days from 06-01.

So with `today` 2026-11-15 it gives **Oct 114, Nov 122, Current 122**: the last ten ages are 82, 97, 111, 120, 128,
125.69, 128, 130, 146 and 155; their mean is 122.27, which rounds to 122. With `today` 2026-10-09 it gives one point,
Oct **105** (1045.69/10). With `today` 2026-10-08 there are only 9 outflows, so no value.

**Size.** One query reads a plan's whole history of cash-account rows:
- it selects 5 columns and is ordered in SQL; the index `transactions_budget_date` serves it;
- a ten-year plan at about 200 cash rows a month is about 24,000 rows, roughly 1.5 MB, in **one** D1 query;
- the arithmetic is one O(n) pass, using a bucket queue with a head index.

## Approach

- **Pure arithmetic** `packages/schema/src/age-of-money.ts`, unit-tested in `packages/schema/test/age-of-money.test.ts`:
  rows, the set's account ids and `today` go in; ages, months and `current_days` come out. The chart helpers
  (`aomTopTick`, `daysLabel`) live there as well.
- **One read** `ageOfMoneyRows(db, budgetId, today)` in `repositories/reports.ts`. It imports `countsInBalance` from
  the transactions repository, which is not edited. The set's ids come from `reportAccounts`, an existing accounts
  read, not a rows read.
- **Service, route, tool**, following the Net Worth pattern.
- **Screen** `AgeOfMoneyReport` and `AgeOfMoneyChart`, in the app's own SVG like `NetWorthChart`. No chart library.
- **EXF-615**: the visible Spending Trends marker takes the pointer.
- **No migration. No new dependency.**

## Interfaces

**`GET /api/v1/budgets/{budget_id}/reports/age-of-money`**
- Query: `today` (optional, `Today`).
- Returns `{ data: { current_days: integer | null, months: [{ month: "2026-10-01", days: 114 }] } }`, months oldest
  first.
- An unknown plan gives 404; a bad `today` gives 422.

**MCP `get_age_of_money { budget_id, today? }`** returns the same `data` object.
- Its description says what the number means, which accounts count, what is ignored, that the value is null (and
  months empty) below 10 outflows, `MONTH`, and `dates("today")` with its default. The spec gives the wording.
- No timestamps are returned.
- Coverage: `"GET /budgets/{budget_id}/reports/age-of-money": { tool: "get_age_of_money" }` in
  `mcp-coverage/reports.ts`.
- One `CALLS` line in `mcp-timestamps.test.ts`, after `get_income_expense`.

**Web:** `useAgeOfMoney(budgetId, today)` in `api/reports.ts`:
- query key `["age-of-money", budgetId, today]`;
- `placeholderData: keepPreviousInPlan(budgetId)`;
- the page remounts per plan already (`ReportPage` is keyed by `budgetId:report`).

## Screen (EXF-553)

`/:budgetId/reflect/age-of-money` keeps the frame as it is: the title "Age of Money", no Export and no filter bar
(`ReportFrame`'s `isAge`). The body is `AgeOfMoneyReport`, in place of the placeholder line, which is removed. Two
cards are stacked, both full width, 16px apart.

**Chart card** `section.aom-card` (`aria-label="Age of Money chart"`):
- background `--backgroundSecondary`, radius 8, padding 16;
- top row: `Current` (14/500 `--labelSecondary`, padding-bottom 4), then the value (30/700 `--labelPrimary`,
  `data-testid="aom-current"`):
  - `daysLabel(current_days)`: `122 days`, or `1 day` for exactly one *(not compared)*;
  - `—` (U+2014) when null. This was decided by the Lead; the source shows no "Current" in its empty state.
- **With points:** the `AgeOfMoneyChart` SVG, 320 high:
  - plot top 16, plot height 256, then 48px for two-line x labels; left 72, right 16;
  - y scale 0 → `aomTopTick(max days)`, which rounds up to a step of `max(1, 10^floor(log10 max) / 5)`: 141 → 160,
    122 → 140, 114 → 120; 0 gives 10;
  - **two y labels only**: `0 days` at the baseline and `<top> days` at the top, 12/500 `--labelSecondary`,
    right-aligned at x = left − 8;
  - a dashed gridline at the top and a dashed baseline at 0, both `--aom-grid` with dasharray 2,2;
  - one column per month and the point at the column centre;
  - the area from the first to the last point down to 0, filled `--aom-area`;
  - the line, 4px `--aom-line`, round joins;
  - markers r=4, fill `--aom-line`, an 8px `--aom-ring` stroke, so 8px of radius is visible;
  - x labels `Oct` on one line and `2026` on the next, 12/500 `--labelSecondary`, centred. When a column is under
    40px only every k-th month is labelled (k = ceil(40/col)), counting back from the last month *(not compared)*;
  - one point: the marker only, no area.
- **Hover:**
  - a transparent `rect.aom-hover[data-month]` per month covers its whole column and the plot height. It is drawn
    **last**, so it lies over the line and the marker, and every point of a marker is inside its own month's
    column. EXF-615's flaw cannot happen here;
  - entering a column fills that month's marker `--aom-selected` (class `selected`) and draws a dashed (2,2) 1px
    `--aom-selected` vertical line through the column centre, from the plot top to the baseline;
  - it shows `div.aom-tooltip[role=tooltip]` **below** the point: its top is 12px under the point, centred on it,
    with a 15px arrow pointing up; background `--backgroundTertiary`, radius 4, padding 16, max width 160,
    min height 64, the source's shadow;
  - the tooltip's lines are `Oct 2026` (`monthLabel`, 14/500 `--labelSecondary`, margin-bottom 4) and `114 days`
    (18/600 `--labelPrimary`);
  - leaving the column hides it;
  - **a click does nothing**: no handler, no cursor change.
- **Empty state** (`months` empty):
  - "Current" `—`, then a centred callout `div.aom-empty` (`role="status"`) inside a 46px 24px padded area. Max
    width 374, padding 16, radius 8, background `--aom-callout-bg`, white text centred;
  - `h2.aom-empty-title` "Spend more money!" (18/600, margin 0 0 4), then `p` (14/500, margin 0) "Strange advice, we
    know. Budget needs a minimum of 10 transactions to calculate your Age of Money.";
  - this is the source's text with the app's name in place of the source's. It was observed, so this is not a text
    of our own; it differs from the Lead's "one line of text you choose" only by having a heading;
  - there is no SVG in the empty state.
- **Loading:** nothing in the card body until the data comes. A plan switch never shows the old plan's value, by
  `keepPreviousInPlan` and the remount.

**Info card** `section.aom-info` (`aria-labelledby` its heading):
- `h2` "Understanding Age of Money": 14/600 `--aom-heading`, padding 16, 1px bottom border `--borderSubtle`;
- then the ticket's two paragraphs word for word, 14/500 `--labelSecondary`, inside 16px padding, `p` margin
  14px 0;
- no icon.

**New custom properties** (on `.aom-report`, in the new `reflect/age-of-money.css`):
- `--aom-line: #f1f1ff`;
- `--aom-ring: rgba(255, 255, 255, 0.149)`;
- `--aom-selected: #93d53e`;
- `--aom-grid: rgba(255, 255, 255, 0.102)`;
- `--aom-area: rgba(147, 213, 62, 0.3)` *(the ticket's "light green"; not compared)*;
- `--aom-callout-bg: rgba(60, 62, 83, 0.6)`;
- `--aom-heading: #f1f1ff`.

**No new icon.**

## EXF-615: the Spending Trends marker

In `TrendsChart.tsx`:
- the visible `circle.st-marker` (r=5, drawn after the bars) takes the pointer. The CSS changes `pointer-events: none`
  to `pointer-events: visiblePainted`, so the painted dot and its stroke count;
- it gets the same `onMouseEnter`/`onMouseLeave` as the hit circle (tooltip `Mon YYYY` / total / `Total Spending`);
- **a click on the marker is passed to the segment under it.** `onClick` finds the `.st-seg` of the same month under
  the pointer with `document.elementsFromPoint(clientX, clientY)` and calls the same `onPick` that segment would.
  With no segment there it does nothing;
- a click on a segment beside or below the dot reaches the segment directly, as before;
- the larger `circle.st-hit` (r=10, transparent) stays **under** the bars, unchanged, so a month with no spending
  behaves as it does today (615-3);
- nothing else changes: no figure, no tooltip text, no style besides `pointer-events` and `cursor`. The marker's cursor is
  `pointer`, as the source's circle (measured by the Designer; corrected from "unchanged: default").

## Downstream effects

- `e2e/reflect-frame.spec.ts` stops expecting "This report is not built yet." and expects the info card's heading.
  Every report is built, so the placeholder is gone.
- `REPORTS["age-of-money"]` (the page title "Age Of Money") is unchanged.
- New REST path and new tool: the OpenAPI and MCP derived tests pick them up from the globs.
- No change to other reports' queries. `spendingRows`, `incomeRows` and `monthlySums` are untouched.

## Out of scope

- The source's segmented control in the chart's top row, whose labels were not observable.
- The light theme; keyboard access to chart points (the "Current" value and the API carry the figures).
- Any change to the definition beyond the Lead's notes; caching the value.

## Acceptance

Defaults:
- Each case makes its own plan through the API.
- The browser clock is fixed at 2026-11-15 12:00; the API gets `today=2026-11-15` unless stated.
- The window is 1600×900 unless stated.
- Hovers and clicks use the real mouse, after checking with `document.elementFromPoint` that the aimed element is
  the one meant; `realClick` comes from `e2e/support/register-seed.ts`.
- **Example** = `seedSpendingExample` (e2e) / `examplePlan` (Worker).

1. (553-6, unit) `age-of-money.test.ts`:
   - the ticket's rows give the ages `[56, 68, 82, 97, 111, 120, 128, 125.69 (±0.005), 128, 130, 146]`;
   - with `today` 2026-10-31: months `[{2026-10-01, 114}]` and `current_days` 114;
   - with `today` 2026-11-15: `[Oct 114, Nov 114]`;
   - the extra cases in the spec, task 1: fewer than 10; an internal transfer; a split as its parent; buckets running
     out; a month with no outflow; a same-day inflow; rows after `today`; `aomTopTick`; `daysLabel`.
2. (553-2, 553-5, Worker) Example:
   - `GET …/age-of-money?today=2026-11-15` returns exactly
     `{ current_days: 122, months: [{2026-10-01,114},{2026-11-01,122}] }`;
   - `today=2026-10-31` returns `{114, [Oct 114]}`; `today=2026-10-09` returns `{105, [Oct 105]}`;
     `today=2026-10-08` returns `{null, []}`;
   - `get_age_of_money { budget_id, today: "2026-11-15" }` returns an object equal to the REST `data`.
3. (553-6, Worker) Plan **Z**, `today=2026-01-31`:
   - Checking with a +1,000.00 Starting Balance on 01-01, Savings 0 on 01-01, Card (`creditCard`) 0 on 01-01;
   - Checking→Card −50.00 on 01-03; Checking −10.00 on each of 01-11 … 01-18 (8 rows);
   - a split −100.00 on 01-20 (−60.00 / −40.00);
   - Checking→Savings −300.00 on 01-21; Card −20.00 on 01-25.
   - Result: `{ current_days: 13, months: [{2026-01-01, 13}] }`. The ages are 2, 10…17 and 19; the mean is 12.9.
     Counting the split's lines, the internal transfer or the card's own spending would each give 15.
4. (553-1) Plan **E**: Checking +500.00 on 2026-11-01 and three outflows of −10.00 on 11-02, 11-03 and 11-04.
   - The API returns `{ current_days: null, months: [] }`.
   - Screen: `aom-current` reads `—`; the status shows `Spend more money!` and the text above exactly; there is no
     `.aom-chart svg`; the info card is visible.
   - **Compare** the source's Age of Money tab in this Thread's source tab as found: the test plan, dark,
     1600×813, empty state, changing nothing. Compare the callout's size, padding, colours and type, the info
     card's heading, border and paragraphs, and the 16px gaps. Known differences: our "Current —" row, and the
     app's name.
5. (553-2, 553-3) Example, on the screen:
   - `aom-current` is `122 days`;
   - two markers; x labels `Oct`/`2026` and `Nov`/`2026`; y labels exactly `0 days` and `140 days`;
   - hover the Oct marker's centre: the tooltip shows `Oct 2026` and `114 days`, below the point (tooltip top >
     marker centre y);
   - hover the Nov marker's centre, its lower edge (centre y + 6), and a point in Nov's column 40px above the marker:
     each time the tooltip is `Nov 2026` / `122 days`, which equals "Current";
   - the hovered marker has class `selected` and its fill is `rgb(147, 213, 62)`;
   - a click on the Oct marker opens no dialog and leaves the URL unchanged.
6. (553-4) Example:
   - the info card's heading is `Understanding Age of Money`;
   - its two paragraphs equal the ticket's copy exactly;
   - there is no `Export`, `Previous Period`, `All Accounts` or `All Categories` button;
   - the frame spec's Age of Money step expects the heading instead of the placeholder.
7. (553-7) Plan **X** = Example, plan **Y** = plan E:
   - open X's Age of Money and wait for `122 days`;
   - hold Y's `reports/age-of-money` request, then go to `/{Y}/reflect/age-of-money` client-side (the `goClientSide`
     pattern of `reflect-followups.spec.ts`);
   - at 0s, 1s and 2s the body contains neither `122 days`, nor `114 days`, nor `Oct 2026`;
   - release the request: `aom-current` reads `—`.
8. (553-3, narrow) Example at 1024×700:
   - scroll the chart into view, then hover the Nov marker with the real mouse: the tooltip `Nov 2026` /
     `122 days` is fully inside the window;
   - the document does not scroll sideways (scrollWidth ≤ clientWidth).
9. (615-1) Example; Spending Trends with a stored Custom range **Sep–Sep 2026**:
   - here the top segment is `uncategorized` (15.00) over `D8 Group` (160.24), and the month total is $175.24;
   - hover the centre of `.st-marker[data-month="2026-09-01"]`: `elementFromPoint` is the marker, and the tooltip is
     `Sep 2026` / `$175.24` / `Total Spending`;
   - the same at the marker's lower edge (centre y + 5), where the segment lies under the dot.
   - **The spec is run once against the code before the change and fails there.** Record this in the report.
10. (615-2) Same plan and range:
    - click (real mouse) the middle of Sep's `uncategorized` segment. `segmentPoint` checks it is topmost; it is
      about 10px below the marker centre. The dialog `Uncategorized Transactions–SEP 2026` opens; close it;
    - then click the marker 3px below its centre, which is over the segment: the same dialog opens;
    - click a Sep `D8 Group` segment point: the heading becomes `All Groups › D8 Group`, the drill.
11. (615-3) The existing 550-3 (hover the Jun marker, a month with no spending) and 550-6 (the empty plan's marker)
    still pass unchanged.
12. (Worker) The surface: `apiPaths()` contains `/api/v1/budgets/{budget_id}/reports/age-of-money`, and
    `listedToolNames()` contains `get_age_of_money`. An unknown plan gives 404, and `today=2026-02-30` gives 422.
13. (All) `pnpm check` passes; the specs `e2e/age-of-money.spec.ts`, `e2e/spending-trends.spec.ts` and
    `e2e/reflect-frame.spec.ts` pass with `--repeat-each=2`.

## Manifest

touches: [packages/schema/src/reports.ts, packages/schema/src/age-of-money.ts, packages/schema/test/age-of-money.test.ts, apps/worker/src/repositories/reports.ts, apps/worker/src/services/reports.ts, apps/worker/src/routes/reports.ts, apps/worker/src/mcp/tools/reports.ts, apps/worker/test/age-of-money.test.ts, apps/worker/test/mcp-coverage/reports.ts, apps/worker/test/mcp-timestamps.test.ts, apps/web/src/reflect/**, apps/web/src/pages/reflect.tsx, apps/web/src/api/reports.ts, e2e/reflect-frame.spec.ts, e2e/age-of-money.spec.ts, e2e/spending-trends.spec.ts, docs/age-of-money-design.md, docs/age-of-money-spec.md, docs/README.md]
shared: []
migrations: 0
