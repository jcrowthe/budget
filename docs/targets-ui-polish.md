# Targets UI: polish list

- P1 [applied] Form card: `PanelCard ruled` (only TargetCard's form) draws a padded static header over a `borderSubtle` rule and a body padded 16; Notes keeps its layout.
- P2 [applied] Empty card: strong and explanation use labelPrimary, strong weight 700, body padding 16, scoped to `#panel-target`. Departs from the design doc's labelSecondary/600; the live source value is restored.
- P3 [applied] Selects: `appearance: none` with a caret drawn on a new `.select-wrap` span around each `.target-select` (6px inputBorder triangle, 8px from the right).
- P4 [applied] Behaviour dropdown label weight 500; border and caret take buttonPrimaryBackground while `aria-expanded="true"`.
- P5 [applied] Cancel uses buttonGhostLabel; Delete icon gap totals 8.
- P6 [applied] Behaviour popup 14px/line-height var(--line-height), help line margin totals 12, tagline weight 500; hover fill removed, kept on :focus-visible.
- P7 [applied] Calendar arrows 16x16 icons in 32x32 buttons (ghost label colour); days 14/500, weekday row 24.8 high on a rule, no gap between day rows, title line-height 19.2.
- P8 [applied] The date field's icon is a 28x32 button (padding 0 8, labelTertiary) that opens the calendar.
- P9 [applied] Hover states: unselected tab, Cancel, Delete, Save Target, Create Target and Edit Target as measured. Create/Edit keep the clone's 0.27 hover from buttonSecondaryBackgroundHover (the source's token is the same value).

Second pass:

- P2 (again) [applied] The selector never matched: `#panel-target` is on the body itself. Now `#panel-target.panel-card-body:has(> .target-empty)`, so only the empty card has padding 16 all round.
- P6 (again) [applied] The last behaviour option has no bottom rule (the source rules only between options).
- P7 (again) [applied] Calendar: arrow row 32 with margin 3.2 and no padding; weekday row 26.8 between 1px rules; day grid padding 4 0 and margin-bottom 6.4; cells 31.4 square.
