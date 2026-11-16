# Spending Trends and Income v Expense polish (EXF-550, EXF-552)

Designer's list, applied on the feature's own files only (`IncomeExpenseReport.tsx`, `income-expense.css`,
`TrendsChart.tsx`, `TrendsTable.tsx`, `spending-trends.css`, `icons.tsx`). Nothing shared changed.

- I1 [applied] colgroup widths in px from the measured `.ie-scroll` width (ResizeObserver): first `96 + 3/(c+5)·(W − 96 − 64·(c+2))`, others `64 + 1/(c+5)·(…)`, table min-width `96 + 64·(c+2)`. (A px+% `calc()` on a `<col>` is dropped by Chrome in a fixed table, so round 1 did not take effect.) The spec §8 colgroup line is superseded.
- I2 [applied] header labels `--labelPrimary`; a 16px spacer row under the header (the `--inputBorder` line stays on the header cells).
- I3 [applied] `.ie-heading td` has the same border-bottom and background as the th; the toggle has `line-height: 1`; rows are 39px.
- I4 [applied] group rows have border-bottom `--ie-row-line` on every cell.
- I5 [applied] group total: name cell border-right `--borderSubtle`, every cell border-bottom `--ie-row-line`.
- I6 [applied] section total: name padding-left 32px, no border-left on amounts, border-bottom on every cell.
- I7 [applied] `.ie-table .ie-net td.ie-amt` has no border-left.
- I9 [applied] the amount button fills the cell (padding 8px moved inside, last column 16px right), so hover anywhere in the cell shows pointer and underline.
- S1 [applied] plot left inset 31px with no y ticks (spec §8 "21" superseded); the case with ticks (72) could not be seen in the source.
- S2 [applied] x ticks 6px, 1px, `--labelPrimary`.
- S3 [applied] the Compared th content is an inline-flex row (gap 8px, centred), so the header row is 49px.
- S4 [applied] number cells padding-right 0; compare cells 11rem content width, padding-left 16px, padding-right 24px.
- S5 [applied] tooltip left-aligned, line-height 1.2; the marker tooltip is anchored at the marker centre (bottom edge 12px above it); the 15px arrow starts 3px inside the box so its tip reaches the marker centre (spec §8 "centred" superseded).
- S6 [applied] hint line-height normal, centred on the icon and clamped to the window with a 10px margin (shift set on hover/focus).
- S6b [applied] the info button is a 16px-high box with the 12×12 glyph centred, so the hint sits 8px above the icon's 12×16 box.
- S7 [applied] new `InfoFillIcon` (12×12, filled circle) used by TrendsTable only; NetWorthReport keeps `InfoIcon`.

Measured values come from the Designer's captures (`polish-*-dark-source.png`); this build adds no visual-value assertions.
