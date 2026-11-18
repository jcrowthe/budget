# Payee renaming rules (EXF-467): polish list

Not compared with the source (design rule: no step opens the source); each value is compared with the clone's own neighbour. Dark theme only.

- P1 [applied] Gear span made `display: flex` so the 16px icon is centred in the 33px row (`.mp-rules-slot > span`).
- P2 [applied] `.mp-rule:last-child { margin-bottom: 0 }`: 16px below the last row, as the Payee Name card.
- P3 [applied] `−` and `+` buttons 32×32 (grid column 32px), as the 32px inputs.
- P4 [applied] `.mp-main` takes `scrollbar-color: var(--inputBackground) transparent; color-scheme: dark` (as `.account-modal-body`).
- P5 [applied] `.bank-import-info svg` 14×14, `pointer-events: none` (as `.match-link svg`).
- P6 [applied] The popover's refusal is left-aligned at `--font-size-sm`.
- P7 [applied] `.bank-import-link:focus-visible` draws the 2px `--actionPrimary` ring of `.mp-link`.
- P8 [applied] `.mp-pane .mp-rule-button:disabled` uses `--menuHover`, `--labelTertiary`, opacity 1 (as `.mp-pane .mp-button:disabled`).
