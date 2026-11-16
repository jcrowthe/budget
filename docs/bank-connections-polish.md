# Bank connections polish (EXF-459)

- P1 [scoped] `.bank-search .account-field { margin-bottom: var(--space-2) }`; `.account-field` unchanged globally.
- P2 [applied] `.bank-search h3`: margin 0, padding-bottom `--space-3`.
- P3 [applied] `.or-divider` (used only by the bank search): margin 10px 0, white 600 text in a span with padding 0 10px, lines 1px rgba(255,255,255,.1) (literal: `--separatorStandard` lives in plan CSS held by other Builds).
- P4 [applied] Divider and "Add an Unlinked Account" moved into `BankSearch`, shown only with Popular Options (sidebar variant); e2e asserts absence after "plat"/"zzqxv" and presence after clearing.
- P5 [applied] `.institution-row` padding 8px 0, logo margin-right `--space-3` (row gap dropped), text column gap `--space-1` and padding-right `--space-2`, list margin-bottom `--space-3`.
- P6 [applied] Row hover name colour #a3acff (the value of `--labelAction`, a literal because that token is defined in plan CSS held by other Builds).
- P7 [applied] Placeholder disc and glyph as `--bankLogoFallback` / `--bankLogoFallbackGlyph` on `.bank-logo.placeholder` (pixel samples, commented).
- P8 [applied] `.bank-tile:hover` no background; children opacity 0.9.
- P9 [scoped] `.account-modal .secondary.large:hover:not(:disabled)` background rgba(117,131,255,.27); `.secondary.large` unchanged globally.
- P10 [applied] `.bank-note` `font-style: normal`; design doc corrected.
- P11 [applied] "continue setting up this account" is an inline `span role="button"` (tabIndex 0, Enter/Space) so it wraps; accessible name unchanged.
- P1 [scoped] `.account-modal-body` gets `scrollbar-color: var(--inputBackground) transparent` (source rgb(60,62,83) = #3c3e53; `--actionSecondary` is defined in plan CSS held by other Builds, same value) and `color-scheme: dark`; no global rule on `body` (not requested).
