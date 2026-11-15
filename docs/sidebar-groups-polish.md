# Sidebar groups polish (EXF-483)

- P1 [applied] Balance text 1.2px too high: shared `.value` rule gets `margin-bottom: -0.2em`; the negative pill margin becomes `0 -0.265rem 0 0.5rem` and the LOANS negative `0 0 -0.2em`. Scoped to the `.nav-account-*` classes.
- P2 [applied] Chevron 1px too low: `.nav-account-block .chevron` gets `position: relative; top: -1px`. Scoped to the feature's class.
- P3 [declined] CLOSED order: the ticket (seen: Checking Main listed first after closing in another order), the Lead's scope note 3 and acceptance case 6 all say sorted by name A→Z. The source's DOM order differs; this is the Lead's call, so the sort and its tests are unchanged.
- P4 [applied] Pencil shown at rest on the selected row: removed the `.is-selected` and `:focus-within` selectors from the visible rule; it shows on row hover and `:focus-visible` only (source: hidden on the selected row), still focusable (opacity 0). Scoped to `.nav-account-row`.
