# EXF-493 polish list

- P1 [applied] Icons redrawn to the source's proportions: ring r=11 stroke 2, chevrons 2 units thick, wide rounded caret (`plan/monthNavIcons.tsx`).
- P2 [applied] The caret turns active when the whole date column is hovered (`.plan-header-date:hover .month-button svg`).
- P3 [scoped] `.plan-header button:focus-visible` outline in `actionPrimary`, offset 2px on Today and OK (OK width 2px); scoped to the header, the shell's global rule is not touched.
- P4 [applied] `.month-picker` height 12.3em (196.8px), on the picker only.
- P5 [applied] Textarea `display: block; line-height: 1.2`; the actions keep 12.24px padding on all sides.
