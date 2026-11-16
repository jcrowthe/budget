# Reflect at a narrow window: implementation spec

Design: [reflect-narrow-design.md](reflect-narrow-design.md) (EXF-625, EXF-626, EXF-621). Read its Approach and
Acceptance first; this file lists the tasks, signatures and checks. Files are only those in the design's Manifest.

Ground rules for this Build: the source app is not opened, read or captured by anyone. No Worker file, no
migration, no dependency, no edit under `e2e/support/**`. Real mouse in specs (`document.elementFromPoint` check,
then `page.mouse`; `realClick` imported from `e2e/support/real-click.ts`). Exact names (`{ exact: true }`).

## T0. Measure before changing anything

On the unchanged code, with the new spec's data N (write the seed of T3 first), at 1024×700 and 1440×900 record:
`.ie-scroll` `clientWidth`/`scrollWidth`, `table.ie-table` `offsetWidth`, the first column's and each amount
header's `getBoundingClientRect().width`. Keep the 1440 numbers for acceptance 3 and the report. Then run each of
the three new tests (T3a, T3b, T4b) once on the unchanged code and keep the failing line of each for the report
(expected: T3a on the TOTAL amount box `scrollWidth`, or on the one-column overflow; T3b on `All Income Sources`
shortened without an ellipsis; T4b on `elementFromPoint` being a `rect.aom-hover`).

## T1. Income v Expense widths (`apps/web/src/reflect/IncomeExpenseReport.tsx`)

1. A module-local pure function (not exported unless needed):

   ```ts
   interface IeWidths { first: number; other: number; table: number }
   /** width: box clientWidth; n: amount columns (months + 2); firstNeed/amountNeed in px (measured). */
   function ieWidths(width: number, n: number, firstNeed: number, amountNeed: number): IeWidths
   ```

   - `units = n + 3`, `spare = max(0, width − (96 + 64·n))`, `f0 = 96 + 3·spare/units`, `o0 = 64 + spare/units`
     (today's arithmetic, unchanged).
   - `F = min(320, max(96, ceil(firstNeed)))`, `A = max(64, ceil(amountNeed))`.
   - If `f0 ≥ F && o0 ≥ A` → `{ first: f0, other: o0 }`.
   - Else if `F + n·A ≤ width` → `first = max(F, min(f0, width − n·A))`, `other = (width − first)/n`.
   - Else → `first = F`, `k = floor((width − F)/A)`, `other = k ≥ 1 ? (width − F)/k : A`.
   - `table = first + n·other`.
   Constants: `FIRST_MIN = 96`, `FIRST_MAX = 320`, `AMOUNT_MIN = 64`, `AMOUNT_PAD = 25` (8 + 16 padding + 1 border),
   `CARET = 16` (8 px icon + 8 px gap), each with a one-line comment.

2. Measurement in `Table`, with a ref on the `<table>` (`tableRef`):

   ```ts
   const [needs, setNeeds] = useState<{ first: number; amount: number }>({ first: 0, amount: 0 });
   useLayoutEffect(() => { ... }, [data, collapsed]);
   ```

   - `textWidth(el: Element): number` = `Range.selectNodeContents(el)` → `getBoundingClientRect().width`.
   - `first` = max over `tbody th.ie-first` that do not contain `.ie-sr`: `textWidth(label element)` +
     computed `paddingLeft + paddingRight + borderRightWidth` of the `th` + (`th` contains an `svg` ? `CARET` : 0).
     Label element = `.ie-label` inside the cell if present, else the `th`.
   - `amount` = max over (`td.ie-amt .amt` and `thead th:not(.ie-first)`) of `textWidth(el) + AMOUNT_PAD`.
   - Round both up to whole px and `setNeeds` only when either changed (no render loop: text widths do not
     depend on column widths).
   - Also re-measure once on `document.fonts.ready` (guard for `document.fonts` being undefined), so a late web
     font cannot leave widths short.

3. Use it: `const w = ieWidths(width, c + 2, needs.first, needs.amount)`; `<col>` widths `w.first` / `w.other`;
   `<table style={{ width: w.table }}>` replaces `style={{ minWidth: base }}` (in the "today" case `w.table`
   equals the box width, so 1440 is unchanged). Keep the `ResizeObserver`. Update the colgroup comment to say
   the widths are today's flex arithmetic with measured minimums (EXF-625/626).

Verify: `pnpm check`; T3a/T3b pass; T0's 1440 widths unchanged within 0.5 px.

## T2. Labels: ellipsis and tooltip (`IncomeExpenseReport.tsx`, `income-expense.css`)

- Every first-column `th` that shows a label gets `title={label}`: heading rows (`Income`, `Expense`, and the Net
  Income heading `Net Income`), group rows (`All Income Sources`, group names), items (payees, categories,
  `Uncategorized Transactions`) and totals. Not the `ie-sr` cells (`Category`, `Net Income by month`).
- In `heading()` and `groupRow()`, wrap the label in `<span className="ie-label">{label}</span>` inside
  `button.ie-toggle` (caret order unchanged: before the label in headings, after it in groups).
- CSS (in `income-expense.css`):
  - `.ie-toggle { max-width: 100%; }`
  - `.ie-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
  - `.ie-toggle svg { flex-shrink: 0; }`
- Accessible names stay the label text (check: existing `button(page, "D8 Group")` and `rowheader` locators in
  `e2e/income-expense.spec.ts` still resolve).

Verify: T3b passes; `e2e/income-expense.spec.ts` passes unchanged.

## T3. New spec `e2e/income-expense-narrow.spec.ts`

Imports: `expect, test` from `./fixtures`; `authHeaders` from `./support/auth`; `addAccount, newPlan, openReport`
from `./support/reflect`; `setRange` from `./support/spending-breakdown-seed`. No edit to `e2e/support/**`.

Seed `seedNarrow(request)` local to the file: data N exactly as the design's Acceptance (plan via `newPlan(request,
"ie-narrow")`; groups via `POST /api/v1/budgets/{id}/category_groups` `{ name }` then
`POST …/categories` `{ group_id, name }`; transactions via `POST …/transactions` with `account_id`, `date`,
`amount` in milliunits, `payee_name`, and `inflow_to_ready_to_assign: true` for income or `category_id` for
spending; assert each status < 300). Then `setRange(request, id, "income-expense", "2026-07-01", "2026-11-01")`.

Helper `ready(page)`: wait for `rowheader` `Net Income` and `columnheader` `TOTAL` (exact), then until two reads
100 ms apart of the TOTAL header's `boundingBox()` are equal.

Helper `measure(page)` (one `page.evaluate`) returning:
- `labels: { text, title, shortened, ellipsis }[]` for every `tbody th.ie-first` without `.ie-sr`
  (`text` = label element `textContent`, `shortened` = label element `scrollWidth > clientWidth`,
  `ellipsis` = computed `textOverflow === "ellipsis" && overflowX === "hidden"` on the label element);
- `total: { overflow: boolean }[]` for each row's last `td.ie-amt` (amount box `scrollWidth > clientWidth`);
- `box: { left, right, clientWidth, scrollWidth }` of `.ie-scroll`, `totalHeader: { left, right, width }`,
  `headerRights: number[]` (right edges of every `thead th`), `doc: [scrollWidth, clientWidth]`.

Tests (names begin with the ticket):

- **T3a** `625 at 1024×700 every TOTAL amount is whole and the table scrolls by whole columns` — acceptance 1.
  `page.setViewportSize({ width: 1024, height: 700 })` before `openReport(page, id, "income-expense")`.
  Assert `total` has no overflow; then the fits-or-scrolls condition; in the scrolling case assert some
  `headerRights` value is within 1 px of `box.left + box.clientWidth`, set `scrollLeft = scrollWidth`, poll until
  `scrollLeft > 0`, re-measure: TOTAL header inside the box (±1 px), `N Employer` rowheader x unchanged. Assert
  the page does not scroll sideways.
- **T3b** `626 first-column labels are whole or end in an ellipsis with a tooltip, at 1024×700 and 1440×900` —
  acceptance 2. At 1024×700: every label `!shortened || ellipsis`, every `title === text`, and the nine named
  labels are not shortened. Then `setViewportSize({ width: 1440, height: 900 })`, `ready(page)`: no label
  shortened, no TOTAL overflow, `box.scrollWidth ≤ box.clientWidth`.

Verify: `pnpm e2e e2e/income-expense-narrow.spec.ts --repeat-each=3`.

## T4. Age of Money (`AgeOfMoneyChart.tsx`, `e2e/age-of-money.spec.ts`, `docs/age-of-money-design.md`)

a. Code: remove `HOVER_ABOVE` and its comment. `rect.aom-hover`: `y={PAD.top}`, `height={plotH}`. Replace the
   comment with: the hover column covers the plot from its top edge to the baseline (EXF-621). Nothing else.

b. New test `621 the Current value is outside the hover columns` — acceptance 4, using `seedSpendingExample` and
   `openAge` from the same file. Points from `getByTestId("aom-current").boundingBox()` and
   `.aom-chart svg` box. Before moving the mouse, assert in one `evaluate`: `elementFromPoint(x, y)` is the value
   element or inside it. Then `page.mouse.move(x, y)`, `page.waitForTimeout(300)`, expect `.aom-tooltip` count 0
   and `.aom-marker.selected` count 0. Selection: `mouse.move(left + 2, y)`, `mouse.down()`,
   `mouse.move(right − 2, y, { steps: 8 })`, `mouse.up()`; `getSelection()?.toString()` contains `122 days`.

c. Change 553-2's loop: compute `plotTop` = `.aom-chart line.aom-grid:not(.aom-base)` bounding box `y`; for Nov use
   `dy` in `[0, 6, -Math.min(40, c.y - (plotTop + 1))]` (needs the Nov centre first: `markerCentre`). Add after
   it: `hoverMonth(page, "2026-10-01", 0, -40)` → tooltip `Oct 2026` / `114 days` (assert first that Oct's
   centre is at least 41 px below `plotTop`, so the point is inside the plot). Keep a one-line comment naming
   EXF-621.

d. `docs/age-of-money-design.md`, acceptance 5, the bullet "hover the Nov marker's centre, its lower edge … 40px
   above the marker": reword to "… and a point in Nov's column 40px above the marker, or the plot's top edge
   (+1px) where the marker sits less than 40px under it (EXF-621) … ; and 40px above the Oct marker shows
   `Oct 2026` / `114 days`". Change only that bullet.

Verify: `pnpm e2e e2e/age-of-money.spec.ts --repeat-each=3`.

## T5. Survey of the other three reports at 1024×700 (not committed)

Use a throwaway spec under `/workspace/scratch` or a temporary file you delete before committing. Seeds:
`seedSpendingExample` (Spending Breakdown, Spending Trends), `seedExample` from `e2e/support/reflect.ts`
(Net Worth). For each report at 1024×700, after its last element is visible (the chart's last label and the
table's or list's last row), collect in `.reflect-body`, including the report header (title, date range, filter
buttons, Export):
- **cut**: elements with own text where `scrollWidth > clientWidth`, `overflow-x` is not `visible`, and
  `text-overflow` is not `ellipsis`; and text whose box extends past its card's or scroller's right edge;
- **overlap**: pairs of leaf text boxes (`Range` rects) that intersect by more than 1 px.
Fix only what one or two lines of CSS in that report's Reflect CSS file fix (e.g. `min-width: 0`, `flex-shrink`,
`white-space`, an ellipsis); name each in the design's *Narrow-window survey* section with the file and selector,
and re-run that report's spec (`net-worth.spec.ts`, `spending-breakdown.spec.ts`, `spending-trends.spec.ts`). Everything else is listed there as a known issue. Fill that section in any case ("nothing found" is a
result).

## T6. Finish

- `pnpm check`; then `pnpm e2e e2e/income-expense-narrow.spec.ts e2e/income-expense.spec.ts e2e/age-of-money.spec.ts e2e/reflect-frame.spec.ts e2e/reflect-followups.spec.ts e2e/net-worth.spec.ts`.
- `git diff --name-only origin/main` lists only Manifest files.
- Report: the decided layout (scrolls at 1024×700 with five months, fits/today at 1440×900); T0 and after
  measurements at both sizes; the three failing lines from T0; the survey; departure (553-2 wording and Nov point);
  and that the step did not open, read or capture the source app.
