# Ready to Assign and moves: polish list (EXF-491, EXF-492)

- P1 [applied] `.plan-header-totals` is full header height with 8px padding, so the box sits at the source's offset.
- P2 [applied] info icon: margin-left 8px, shown only while the icon itself is hovered (always in the negative state).
- P3 [applied] new optional `scrim` prop on `Popover` (class `has-scrim`, `var(--overlay)`); only `RtaBreakdown` sets it, so Move, Cover, Assign and Fix This stay transparent.
- P4 [applied] breakdown title, card and help box margins use the source's 12.24px content padding.
- P5 [applied] block header icons 16px, 14px/600 tabular-nums amount pushed right.
- P6 [applied] each block wrapped in `.rta-block` (margin-bottom 8px); rule margin 6px, `--borderSubtle`.
- P7 [applied] total amount and message 14px (message 500, line-height 1.2).
- P8 [applied] help box padding 16px, text 14px/500, icon box 32x24.
