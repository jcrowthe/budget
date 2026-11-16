# Polish list: shortcuts dialog (EXF-473, EXF-474, EXF-614)

- P1 [applied] `KeyCaps` wrapper class was `key-caps dialog`, so the global `.dialog` box rules styled it (rows 77–101 high). Renamed to `key-caps is-dialog` / `is-tooltip` in `KeyCaps.tsx` and `shortcuts.css`; no reset added. New e2e assertion: first row 45 high, caps group transparent with no padding.
- P2 [applied] h3 and h2 get `line-height: var(--line-height)` (1.2), scoped to the shortcuts dialog.
- P3 [applied] the ✕ button gets `padding: 0` in the scoped `.dialog.shortcuts .icon-button` rule.
- P4 [applied] `.shortcuts-scroll` gets `scrollbar-color: var(--inputBackground) transparent` (scoped; the global body change is not made because `shell/global.css` is shared).
