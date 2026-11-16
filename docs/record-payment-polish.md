# Record Payment polish list (EXF-539, EXF-635, EXF-636, EXF-637, EXF-630)

Measured by the Designer against the source (dark); the card page itself is built from the ticket text.

- P1 [applied] Payment pill and block: pill padding `.205rem .5rem .125rem`, font `.88rem`, line-height `var(--line-height)`, inside a 27.75px row; label line-height `calc(12px * var(--line-height))`; `.acct-payment` margin `0 1rem 0 0`; `.acct-balances-right` centres its items. The Selected Total carries `margin-right: 1rem` when the block follows it (source: `.accounts-header-payment`, 1568px right edge at 1600).
- P2 [applied] The Payment label uses the Plan's `QuestionCircleIcon` (import only) at 12×12; `InfoIcon` removed. [declined] the explainer dialog ("Using Credit Cards"), out of this Build; the hover tooltip stays.
- P3 [applied] The negative pill formats with the Plan's `money()` (U+2212) and a 12px filled exclamation-circle icon (new, in `account/icons.tsx`), 4px gap. The specs expect `−$50.00`.
- P4 [applied] Record Payment uses a new 16px solid card icon (`SolidCardIcon`) and the title "Quickly record a credit card payment."
- P5 [applied] A payment row focuses Date like Add Transaction (design D2 changed); the spec checks the Date field.
- P6 [applied] visual: the fixed category shows as an enabled-looking field (full opacity, text cursor) via a `readOnly` prop of the picker. [scoped] behaviour: a click does not open the list, as design D4 keeps (a payment's category is fixed); the spec asserts `readonly`, not `disabled`. The Lead may reopen D4.
- P7 [applied] The container query and the clamp() search width are gone. The search stays 192px; below measured toolbar widths (Undo/Redo under 1000px, Record Payment under 880px, the source's window widths less the 260px sidebar) those buttons move into a More button whose popup (232px, Popover) lists them. File Import never hides. [scoped] The source moves buttons one at a time by their measured fit; this build uses two fixed thresholds.
