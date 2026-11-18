# Plan file dialogs: polish list (EXF-476, EXF-477)

Compared: read from the source's style rules (Designer's measurements). All items scoped to the feature's own dialog classes; no shell file edited.

- P1 close button 16×16, no padding, actionPrimary, 16×16 icon [applied] (export and import dialogs; scoped rule in `plan-export-dialog.css`)
- P2 "Don't show again" row: flex, gap 4, padding 2, 0.9rem/400, line-height 1.2, labelSecondary [applied] (selector raised to `.dialog.form .plan-export-dialog-check`)
- P3 checkbox box 13×13, 1px inputBorder, radius 3, checked buttonPrimaryBackground with white check, focus ring [applied] (native input kept, `appearance: none`)
- P4 footer button hover (secondary buttonSecondaryBackgroundHover, primary actionPrimary, .15s) [scoped] (both dialogs' footers, not global: shell files are out of bounds)
- P5 footer keyboard focus ring (2px auto actionPrimary, offset 2px) [scoped] (same reason as P4)
