# Reconcile: polish list (EXF-533)

Measured against the source's ask and bank-balance popovers (dark; light for P1, P2, P4, P5); P6-P8 not re-measured live.

- P1 [applied] Ask step: one `.reconcile-balance-card` holds the label and the amount (padding 16px, radius 8px, `--menuHover`, amount line-height 25.2px); 16px from the card to the buttons. The spec checks `--menuHover` on the card.
- P2 [applied] No and Yes in one row (flex 1, 8px gap, same y), not full width; decision B and case 21 reworded here: each is (inner width - 8) / 2.
- P3 [applied] Arrow: 30x15 clip-path triangle on the top edge, centred on the button (right 36px); popover top = button bottom + 15px, for all three steps.
- P4 [applied] Popover font-weight 500, width 281px.
- P5 [applied] Next sits 8px under the input (no extra margin), no min-width, padding 0 16px.
- P6 [applied] Difference step gap `--space-3` (16px).
- P7 [applied] Difference foot Next: margin 0, padding 0 16px, 16px text, scoped to `.reconcile-diff-foot .primary`; `shell/global.css` untouched.
- P8 [applied] Decision C's label rule scoped to `.reconcile-popover > label`; the checkbox label is flex, 8px gap, weight 500.
