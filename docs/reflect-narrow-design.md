# Reflect at a narrow window: Income v Expense table and Age of Money hover columns

Tickets: **EXF-625** (Income v Expense TOTAL column clipped at 1024×700), **EXF-626** (first-column labels cut at
1024×700), **EXF-621** (Age of Money hover columns lie over the card's "Current" value). Web app only, Reflect files
only. No Worker change, no migration, no new dependency. Implementation spec: [reflect-narrow-spec.md](reflect-narrow-spec.md).

## Source

**The source app was not opened, read or captured for this plan**, by the Lead's instruction for this Build: the
source's test plan has too little data for a five-month Income v Expense table or an Age of Money chart, nothing may
be created there, and the source tab is never resized, so nothing at 1024 px can be compared. There are no study
notes. What the clone follows instead:

- The source's table layout as recorded in [trends-income-design.md](trends-income-design.md) (EXF-552): a sticky
  first column of labels (flex `3 0 96px`), one column per month, then AVERAGE and TOTAL (flex `1 0 64px` each),
  inside a box that scrolls sideways when the months do not fit.
- The app's own rule for a narrow window (EXF-626): no text is cut without an ellipsis; a shortened label shows its
  full text on hover. No amount is ever shortened.
- EXF-621's wanted behaviour, which is the clone's own fix of a review finding (PR 43), not a source comparison.

## What is wrong today (read in the code at `8ec621e`)

**Income v Expense** (`apps/web/src/reflect/IncomeExpenseReport.tsx`, `Table`): the box width `W` is measured with a
`ResizeObserver`; with `n = months + 2` amount columns the `<col>` widths are
`first = 96 + 3·spare/(n+3)`, `other = 64 + spare/(n+3)` where `spare = max(0, W − (96 + 64n))`. That fills `W`
exactly whatever the content needs. At 1024×700 the box is 700 px; with five months `first ≈ 143`, `other ≈ 80`.

- EXF-625: an amount like `$15,000.00` plus the last column's padding (8 + 16) does not fit 80 px; the text
  overflows its cell (amount cells have no `overflow: hidden`), is cut by the box, and the overflowing text itself
  makes the box 705 px wide (a 5 px scroll nobody can see). The Implementer confirms this cause by measuring
  `table.offsetWidth` (expected 700) against `.ie-scroll.scrollWidth` (705) before changing anything.
- EXF-626: `th.ie-first` already has `overflow: hidden; text-overflow: ellipsis`, so plain-text rows
  ("Total All Income Sources") get an ellipsis, but rows whose label is inside the `button.ie-toggle`
  (`inline-flex`: "All Income Sources", group names, "Income", "Expense") are cut with no mark, because the
  ellipsis applies only to inline text directly in the cell. And 143 px is too narrow for the section labels.

**Age of Money** (`AgeOfMoneyChart.tsx`): each `rect.aom-hover` has `y = −HOVER_ABOVE (48)` and
`height = base + 48`. The svg has `overflow: visible`, so the rects reach 48 px above the svg, over the `.aom-top`
row, from the plot's left edge (72 px) rightwards: the right part of the "Current" value is under a month's hover
column (tooltip shows, text cannot be selected).

## Approach

### 1. Income v Expense: content-aware column widths (EXF-625, EXF-626)

Decision: **the table fits its card when every label and amount fits; otherwise it scrolls sideways inside
`.ie-scroll` with the sticky first column, by at least one whole column, and the box's right edge falls between two
cells.** Why scroll rather than always fit: five or more months of five-digit amounts plus the section labels need
more than 700 px; shrinking amounts is never acceptable, and the table already scrolls this way for long ranges
(552-9). Why the clean edge: a 5 px or half-column overflow is exactly what EXF-625 found invisible.

The widths keep today's formula whenever it already fits the content, so **1440×900 with five months is unchanged
to the pixel**. Two content needs are measured from the rendered table (so fonts, the 16 px Net Income row and
long names are all accounted for):

- `firstNeed`: the widest first-column label as it would be drawn whole (text width + the cell's own horizontal
  padding and right border + 16 px when the cell holds a caret), clamped to **[96, 320] px**. Labels wider than
  320 px are shortened with an ellipsis. The four section labels ("All Income Sources", "Total All Income Sources",
  "Total Expenses", "Net Income") are always far below 320 px, so they are always whole.
- `amountNeed`: the widest amount or column header text + 24 px (8 left, 16 right padding) + 1 px border, at least
  64 px. Every amount column uses this one width, so columns stay equal as in the source.

Widths for `W` (box `clientWidth`) and `n` amount columns (`F = firstNeed`, `A = amountNeed`, `f0`/`o0` = today's
formula):

| Case | Condition | first | other | Result |
|---|---|---|---|---|
| today | `f0 ≥ F` and `o0 ≥ A` | `f0` | `o0` | fills W, exactly as today |
| fits | `F + n·A ≤ W` | `max(F, min(f0, W − n·A))` | `(W − first)/n` | fills W, nothing cut |
| scrolls | otherwise | `F` | `(W − F)/k`, `k = floor((W − F)/A)` (if `k < 1`: `A`) | `k` columns fill the visible part; overflow is `(n − k)·other ≥ one column` |

The table's width is set to `first + n·other` px. In "scrolls", at scroll 0 and at the end the box's right edge is
the boundary between two cells; in between, cells slide under the sticky first column as they do today.

Labels: every labelled first-column cell gets `title` = its full label (a native tooltip; always present, so it is
there whenever a label is shortened). The label text inside `button.ie-toggle` moves into a
`span.ie-label` that can shrink and ends in an ellipsis; the caret never shrinks. Accessible names do not change
(`rowheader` and `button` names are still the label text).

### 2. Age of Money: hover columns inside the plot (EXF-621)

`rect.aom-hover` gets `y = PAD.top` (the plot's top edge, the top grid line) and `height = plotH` (down to the
baseline). `HOVER_ABOVE` and its comment are removed. Nothing else in the chart changes: the tooltip, guide line,
markers and labels stay where they are. The header row of the card is outside every hover column, so pointing at
"Current" shows no tooltip and its text can be selected with the mouse.

The acceptance case that led to the 48 px ("40 px above the Nov marker shows the Nov tooltip") becomes "40 px above
the marker, **or the plot's top edge (1 px inside) where the marker sits less than 40 px under it**". In the
Example plan Nov (122 days, top tick 140) sits about 33 px under the plot's top, so its point moves to the plot's
top edge; Oct (114 days, about 47 px under) keeps the 40 px point and is added to the case to show it still holds.

### 3. The other three reports at 1024×700 (Lead's note 4)

The Implementer measures Net Worth, Spending Breakdown and Spending Trends at 1024×700 with their existing seeds
(spec task T5). A cut or overlapping text that one or two lines of CSS fix is fixed in that report's Reflect CSS file
and named in the section *Narrow-window survey* below; anything larger is written there as a known issue for the
Lead. No survey spec is committed.

## What changes

- `IncomeExpenseReport.tsx`: `Table` measures `firstNeed`/`amountNeed` after render and computes widths with a
  local pure function; `title` on first-column label cells; `span.ie-label` inside the toggle buttons.
- `income-expense.css`: `.ie-toggle { max-width: 100% }`, `.ie-label` ellipsis rules, `.ie-toggle svg { flex-shrink: 0 }`.
- `AgeOfMoneyChart.tsx`: hover rect geometry.
- `age-of-money.css`: no change expected (listed in case the Implementer must adjust pointer rules).
- Specs: new `e2e/income-expense-narrow.spec.ts` (two tests); `e2e/age-of-money.spec.ts` (553-2 wording and point,
  one new test).
- Docs: this file, the spec, one acceptance line in `docs/age-of-money-design.md`, one line in `docs/README.md`.

User-visible: at 1024×700 the five-month Income v Expense table scrolls sideways by whole columns with every amount
and section label whole; at 1440×900 nothing moves. Age of Money's tooltip no longer appears over the "Current" row.

## Downstream effects

- At the e2e default viewport (Desktop Chrome, 1280×720, box ≈ 956 px) the seven-month table of 552-1…552-4 today
  draws `other ≈ 88 px` (amounts cut, unnoticed by text assertions) and now **scrolls**. Those tests read
  `textContent` and click with `realClick`, which scrolls the target into view first; they should pass unchanged.
  If one fails, it is a real defect of this change (e.g. a target landing under the sticky column), not a test to
  edit.
- At 1440×900 with seven or more months the table now scrolls where it previously cut amounts; with five months
  or fewer it is unchanged.
- Collapsing a group or section re-measures; widths can change only when the minimums bind (narrow windows).
- No API, schema, Worker, MCP or CSV change.

## Out of scope

- Any source comparison (see Source). The light theme. Keyboard access to Age of Money points.
- Fixes on Net Worth, Spending Breakdown or Spending Trends beyond one or two lines of CSS each.
- Everything outside `apps/web/src/reflect/**`, `apps/web/src/pages/reflect.tsx`, the Reflect specs and these docs.
  In particular `e2e/support/**` is not edited (seed helpers needed by the new spec live in the spec file).

## Acceptance

Data **N** (made by the new spec through the API; invented names): a new plan; checking account `N Checking`
(Starting Balance 2026-06-01); category groups `N Home` (category `N Rent`) and `N Daily` (category
`N Groceries`); on the 5th of each month Jul–Nov 2026 inflows to Ready to Assign of $2,000.00 from payee
`N Employer` and $1,000.00 from `N Side Work`; on the 10th of each month `N Rent` −$1,200.00 (payee `N Landlord`)
and `N Groceries` −$350.25 (payee `N Market`). Range Jul 2026 – Nov 2026 (`report-settings/income-expense`
custom). TOTAL income is `$15,000.00`. Browser clock 2026-11-15 (`openReport`).

"Label element" of a first-column cell = its `span.ie-label` if it has one, else the `th`. "Amount box" of a cell =
its `button.ie-btn`, else its `span.amt`. "Shortened" = label element `scrollWidth > clientWidth`.

1. **(625) TOTAL whole at 1024×700.** Viewport 1024×700, open `/{N}/reflect/income-expense`, wait for the rowheader
   `Net Income` and the columnheader `TOTAL`. Then:
   - for every TOTAL cell, amount box `scrollWidth ≤ clientWidth`;
   - either the TOTAL header's right edge ≤ `.ie-scroll`'s right edge (fits), or `.ie-scroll`
     `scrollWidth − clientWidth ≥` the TOTAL column's width − 1 (scrolls by at least one column);
   - in the scrolling case: at scroll 0 some column header's right edge is within 1 px of the box's right edge;
     after `scrollLeft = scrollWidth` the TOTAL header lies wholly inside the box and the `N Employer` rowheader's
     x is unchanged (sticky);
   - the page itself does not scroll sideways (`documentElement.scrollWidth ≤ clientWidth`).
2. **(626) Labels at 1024×700 and 1440×900.** Same plan and page.
   - At 1024×700, for every first-column cell with a label (all `tbody th.ie-first` except those holding only
     `.ie-sr` text): not shortened, or its label element's computed `text-overflow` is `ellipsis` and
     `overflow-x` is `hidden`; and the cell's `title` equals its label text.
   - At 1024×700 `All Income Sources`, `Total All Income Sources`, `Total Income`, `Total Expenses`, `Net Income`,
     `N Employer`, `N Side Work`, `N Home`, `N Daily` are not shortened.
   - Resize to 1440×900 and wait for the widths to settle (two equal reads of the TOTAL header's x): no label is
     shortened, no amount box overflows, and `.ie-scroll` `scrollWidth ≤ clientWidth`.
3. **(625) 1440×900 is unchanged.** Before and after the change, at 1440×900 with data N, the `<col>` widths
   (`getBoundingClientRect().width` of the first column's header and of each amount header) are equal within
   0.5 px. Recorded by the Implementer in the report (not a committed test).
4. **(621) "Current" is outside the hover columns.** Example plan (`seedSpendingExample`), open Age of Money, wait
   for `aom-current` = `122 days`. Aim at the "Current" value's right part: x = value box right − 8, y = its
   vertical centre; check x ≥ the svg's left + 72 (inside a month's column range, so the case is meaningful) and
   that `document.elementFromPoint` there is the value element or inside it. Move the real mouse there, wait
   300 ms: no `.aom-tooltip`, no `.aom-marker.selected`. Drag-select with the real mouse from value left + 2 to
   value right − 2: `getSelection().toString()` contains `122 days`.
5. **(553-2, changed by 621)** In the existing case, the hover points for Nov are its centre, its lower edge
   (centre y + 6) and **40 px above the marker, or the plot's top edge + 1 px where the marker sits less than
   40 px under it** (plot top = the top `line.aom-grid`, not `.aom-base`): each time the tooltip is `Nov 2026` /
   `122 days`. Added: 40 px above the Oct marker shows `Oct 2026` / `114 days`. `docs/age-of-money-design.md`
   acceptance 5 is reworded the same way.
6. **(regression)** `e2e/income-expense.spec.ts`, `e2e/age-of-money.spec.ts`, `e2e/reflect-frame.spec.ts`,
   `e2e/reflect-followups.spec.ts`, `e2e/net-worth.spec.ts` pass unchanged except case 5's wording and point.
7. **(note 4 survey)** Net Worth, Spending Breakdown and Spending Trends at 1024×700 measured as spec task T5;
   the results and any one-or-two-line CSS fixes are listed below, each fix named.

Departures (to be listed in the report): case 5 changes the wording and the Nov point of 553-2's "40px above"
check, as EXF-621 asks. No other existing case changes.

## Narrow-window survey

*(Filled in by the Implementer from task T5: per report, what was measured, what was found, each one-or-two-line
CSS fix made, and known issues left for the Lead.)*

## Manifest

touches: [apps/web/src/reflect/IncomeExpenseReport.tsx, apps/web/src/reflect/income-expense.css, apps/web/src/reflect/AgeOfMoneyChart.tsx, apps/web/src/reflect/age-of-money.css, apps/web/src/reflect/*.css, e2e/income-expense-narrow.spec.ts, e2e/age-of-money.spec.ts, docs/reflect-narrow-design.md, docs/reflect-narrow-spec.md, docs/age-of-money-design.md, docs/README.md]
shared: []
migrations: 0
