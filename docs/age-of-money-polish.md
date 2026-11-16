# Age of Money polish list (EXF-553, EXF-615)

- P1 [applied] `.aom-info-content` padding is `var(--space-3)` (16px) on all sides, as the source's info card content.
- P2 [applied] `.aom-info h2` is `display: flex; align-items: center; line-height: 1.5` (21px line, 54px tall).
- P3 [scoped] `reflect-head--age` on the head when `isAge`: `height: auto`, `margin-bottom: var(--space-3)`; other reports keep 32px/12px. The 24px top margin is unchanged.
- P4 [applied] `.st-marker` has `cursor: pointer` (`.st-hit` keeps its default); the design doc's "unchanged: default" line is corrected.
