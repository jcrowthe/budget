# Manage Bank Connections: polish list (EXF-460)

Not compared: built from the ticket. Each item is checked against the clone's own dialogs.

- P1 [applied] The 14px icon rule is limited to the text buttons (`.mc-actions`, `.mc-banner`, `.mc-wide`), so the logo glyph is 18px and the row chevron 16px.
- P2 [applied] `.mc-row` hover has no fill; the name takes `--buttonGhostLabel` (the bank search's measured hover rgb(163,172,255)).
- P3 [applied] In-body buttons: font `--font-size-md`, padding `6px var(--space-3)`, secondary hover `--buttonSecondaryBackgroundHover`, as Sync Now / Unlink Account.
- P4 [applied] Bank-account rows in the detail start with the connection's logo without the dot (`ConnectionLogo dot={false}`, now in `manage-connections-logo.tsx`), as the design says; the spec had left it out.
