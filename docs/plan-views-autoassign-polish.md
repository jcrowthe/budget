# Plan views, snooze and Auto-Assign polish (EXF-500, EXF-516, EXF-519)

- P1 [applied] `.view-chips` padding 0 15px 12px (row 37px, chips flush at the top); `.view-chip` line-height 16px.
- P2 [applied] `.view-empty p` margin 0; `.view-empty .view-all` margin-right 8px (the footer's View All is untouched).
- P3 [scoped] `#panel-auto-assign > .auto-assign-body` padding 0 and `#panel-auto-assign` bottom padding 18px; the Assign popover's body keeps its padding (not comparable at RTA $0).
- P4 [scoped] "View All Categories" gets the `is-ghost` modifier (`.view-all.is-ghost`); the empty message is centred, gap 8px, 14px/500; `.view-all` itself is unchanged.
- P5 [applied] `.auto-assign-option strong` uses tabular-nums.
