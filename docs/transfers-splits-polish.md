# Transfers and splits polish (EXF-526, EXF-524)

- P1 [applied] "Add another split" starts at the minus icon's left edge (date cell right edge − 29.6px) and overflows into PAYEE; padding 4px 8px, gap 8px (`SplitLines.tsx`, `.split-add-cell`).
- P2 [applied] "Amount remaining to assign:" uses `--labelPrimary`, weight 500, right-aligned.
- P3 [applied] The remaining numbers' padding-right 5px now wins over the entry row's cell rule (selector `.entry-row.split-remaining td.split-remaining-number`).
- P4 [applied] Hover backgrounds: minus and "Add another split" `--buttonSecondaryBackground`; the footer Split `--buttonSecondaryBackgroundActive`, scoped to `.entry-split-button:hover:not(:disabled)` so Manage Payees is untouched.
- P5 [scoped] Placeholder colour `#757575` as register-local `--register-input-placeholder` (register.css), used only by `.entry-input input::placeholder`.
- P6 [applied] After Split (footer or `S`) focus goes to the parent row's memo, no list open; "Add another split" still focuses the new line's payee. Design doc line updated.
