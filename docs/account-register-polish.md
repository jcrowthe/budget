# Account register polish (EXF-513)

- P1 [applied] Dropped the `primary` class from Add Transaction, so global.css's `.primary` margin no longer leaks in.
- P2 [applied] Removed the colour overrides and `--register-label-action`; the plan grid's `.toolbar-button` rule (`--labelAction`) now colours text and icons.
- P3 [applied] `.register .toolbar-button svg { width: auto; height: auto }` so the icon attributes (16, 12, 8) apply; the shared rule's `--space-2` gap now applies.
- P4 [applied] Toolbar padding 0; left group padding-left `--space-2`; divider margin-left `--space-3` on `--borderSubtle`; 16px before Undo; right group padding `0 --space-3 0 --space-4`; search box margin-left `--space-3`.
- P5 [applied] Search input padding `0 0 0 28px`, weight 500, `--backgroundPrimary` background, magnifier `--labelTertiary`.
- P6 [applied] Removed `th.sortable` padding-right; the sorted numeric label keeps its 16px margin.
- P7 [applied] Checkbox cells: padding `0 0 0 --space-2`, header cell without right border; 13px square inside a 17×17 button (padding 2px, margin 0 1px).
- P8 [applied] Cleared cell left aligned with padding `0 6.4px`; 16×20 button with the 12px icon at `top: 2px`.
- P9 [applied] Cleared header: `--labelTertiary`, left aligned, padding-left 6.4px, icon `top: 1px`.
- P10 [applied] Text cells padding `1.6px 1.6px 1.6px 6.4px`; OUTFLOW/INFLOW `1.6px 6.4px 1.6px 1.6px`.
- P11 [applied] `--register-separator` and `--register-label-action` replaced by `--separatorStandard` and `--labelAction` (declared in plan/plan-grid.css, which is bundled with the app); a checked row has `cursor: text`.

Second pass:

- P1 [applied] Checkbox cells are `text-align: center` (padding-left `--space-2` kept), centring the 17px button in the 28px content box.
- P2 [applied] `.cleared-button` centres its glyph (`align-items`/`justify-content: center`); the svg offset is now `top: 0.5px`.
- P3 [applied] The cleared header icon is `width={14} height={16}`, as in the source, with `top: 3px` so the ink starts 10px below the row top.
