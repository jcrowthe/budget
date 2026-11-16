# Account header polish

- P1 [applied] `.acct-head-top` aligns its items centre; `.acct-info` line-height is `calc(12px * var(--line-height))` (14.4px); the fixed `min-height: 83.2px` is dropped, the content gives it.
- P2 [applied] `.acct-tooltip` line-height is `normal`.
- P3 [applied] Reconcile tooltip: 8px between label and first key cap, 4px between caps (`kbd + kbd`); label 12px/500, line-height 14.4px.
- P4 [applied] `PencilIcon` redrawn as a solid pencil filling the full 24×24 box, svg kept at 16px.
- P5 [applied] `.acct-title` and the All Accounts `h1` get `padding-right: calc(var(--space-3) + var(--space-2))` (24px).
- P6 [applied] `transition: background-color 0.15s` on `.acct-edit` and `.acct-reconcile`.
