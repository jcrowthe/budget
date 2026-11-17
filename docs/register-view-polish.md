# Register View options polish (EXF-529)

Measured by the Designer against the source's View popover, toolbar and footer (dark theme). Light theme: not compared (the clone has no light tokens; switching the source's theme is forbidden in this Build).

- P1 [applied] `.view-presets` is `flex-wrap: nowrap`: All Dates stays on the first row (source 604.3px of 604px).
- P2 [scoped] `.view-actions .primary { margin-top: 0 }`: Apply sits beside Cancel; the global `.primary` margin is untouched.
- P3 [applied] `.view-range` padding 12px 0; `.view-range-label` padding-right 6px.
- P4 [applied] `.view-checks li` padding-top 8px (border-box, height 28.8px kept).
- P5 [applied] Select caret `border-width: 6px 4px 0; top: 13px`.
- P6 [applied] `line-height: var(--line-height)` on `.view-options-body`.
- P7 [applied] Pill hover = primary background and white text; Cancel hover `--buttonSecondaryBackgroundHover`; Apply hover `--actionPrimary`.
- P8 [scoped] Class `is-view` on the View button only; transparent background while `aria-expanded="true"`. More and the global toolbar-button rule are untouched.
- P9 [scoped] `.register .toolbar-group.right .acct-tooltip.is-above` is 8px above the button; the action bar's 12px tooltip is unchanged.
- P10 [applied] Footer rule raised to `.register-table .register-footer td` (padding 8px 0, no border); `p` margin-bottom 18px.
- P11 [applied] With BALANCE: payee and memo 14%, amounts 8%; the 96px minimum keeps 1024px as before.
- P12 [applied] `no-flags` class on the table; payee and memo `calc(16% + 8.4px)`, amounts `calc(10% + 8.4px)` (and the same shift with BALANCE on).
