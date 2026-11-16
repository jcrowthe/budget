# Plan menu: polish list

- P1 [applied] Submenu placement: `placeSubmenu` now uses `left = row.right`, `top = row.top` (source: left 232, top 98.78 beside the Open Plan row; the clone without a scrollbar gives 244 / 100). `SUB_OFFSET` removed; flip, shift and clamp kept. Scoped: `placeSubmenu` is used only by the plan menu. Design §1 and the two tests (`plan-menu-registry.spec.ts`, `plan-menu.spec.ts`) updated.
