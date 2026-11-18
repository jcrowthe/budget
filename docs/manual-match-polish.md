# Manual match: polish list (EXF-464)

All items compared: read from the source's style rules or script files.

- P1 [applied] The Unmatch button takes the source's secondary look (`--buttonSecondaryBackground`, label, no border, radius 8px, 16px/500, padding 8px 24px, hover colour); it no longer relies on a global `.secondary` class.
- P2 [applied] The panel body sizes to its content (`width: max-content; min-width: 320px; max-width: 100%`), the Popover's 512px / window-16 width stays the cap. Scoped to `.is-match`.
- P3 [applied] `.is-match` has `overflow: visible`, so a long payee gives no scrollbar; the narrow spec still holds the panel inside the window.
- P4 [applied] The title has padding 8px 0 12px and line-height `--line-height`.
- P5 [applied] Header cells get top and bottom borders, a left border on `th + th`, letter-spacing 0.6px and line-height 1.2; cells line-height 1.2.
- P6 [applied] `.is-match` radius is `--radius-xs` (4px).
- P7 [applied] The `.match-link:hover` colour is removed; the focus ring stays.
- P8 [applied] Match and Unmatch move after Clear, before the separator and More (the source's template order); the design and spec lines are corrected.
- P9 [applied] The panel's outer box passes clicks through (`.bulk-popover.is-match { pointer-events: none }`, body and arrow take them), so a click beside a short panel reaches the register, as the source's transparent layer does; scoped to the feature's own class. Compared: read from the source's modal structure.
