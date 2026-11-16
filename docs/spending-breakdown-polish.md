# Spending Breakdown polish list

- P1 [applied] Categories | Groups toggle: track `--reflect-fill-secondary` (#72748452, new token in `.reflect`), selected option `--backgroundTertiary` with a 1px `--borderSubtle` outline, weight 400, padding 4px 8px, gap 8px, hover on an unselected option `--labelPrimary`.
- P2 [applied] Donut radius is 0.375 × height with only the 90px floor; the empty ring gets a 3px `--backgroundSecondary` stroke.
- P3 [applied] Centre text is `--labelPrimary`, block min-height 80px from the top with 8px margin-top, 2px padding-top on the amount, 8px on the percent.
- P4 [applied] Metrics: value 16px/600, row gap 32px, card min-height 180px, sub line `--labelTertiary` with 4px margin.
- P5 [applied] List header bottom padding 20px, body padding 8px with a 1px `--borderSubtle` top border.
- P6 [applied] Empty list text centred, padding 40px 8px, `--labelSecondary`; copy unchanged.
- P7 [applied] Callout under the donut: `--buttonSecondaryBackground`, radius 8px, padding 12px 0, full width.
- P8 [applied] Stacking breakpoint moved from 1279px to 1342px.
- P9 [applied] `.sb-row.active` (row whose popover is open) uses the hover style; rows get `transition: background-color 0.15s`.
- P10 [applied] Bottom fade on the list card (`.sb-list-fade`, 80px gradient, `hidden` when not scrollable or at the end; card is `position: relative; overflow: hidden`).

Also: `get_spending_breakdown` / `list_report_transactions` are called in `mcp-timestamps.test.ts` and `list_report_transactions` uses `dates("date")` (new base test from EXF-587).
