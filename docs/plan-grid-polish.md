# Plan grid polish (EXF-487)

- P1 [applied] Header cells take the body classes `cell-assigned|activity|available`; selectors are by class, AVAILABLE `strong` is 700.
- P2 [applied] Group and category `.cell-name` padding-left 2px (header keeps 6px); `.add-category` gets `padding: 0 var(--space-1)` so the ⊕ stays put.
- P3 [applied] Number-cell paddings per the source: category assigned `0 0 0 16px`, activity `0 2px 0 6px`, available 0; group and header rows keep `0 4px 0 16px` / `0 6px 0 16px`.
- P4 [applied] `.name-line` is 20px high, top-aligned; `.progress-bar` margin `--space-1`; the track margin is gone.
- P5 [applied] Pill is flex, centred, line-height 16px, padding `4px 7px 2px`. The optional group Available text offset is [declined]: optional and risks the shared number-cell layout.
- P6 [applied] Toggle tabs have no border, the selected tab uses a 1px `--borderSubtle` outline, svgs are 0.8rem, both icons redrawn edge to edge (own artwork).
- P7 [applied] Undo, Redo and Clock icons redrawn to span ~1–23 of the viewBox.
- P8 [scoped] New plan-local `PlusCircleFillIcon` in `plan/icons.tsx`, used by the toolbar and the group ⊕; `shell/icons.tsx` is untouched.
- P9 [applied] Removed the ⊕ opacity transition (the source's is none); the icon turns `--labelAction` on pointer hover.
