# Plan panel: polish list

- P1 [applied] Summary rows pitch: the 8 px margin moved to `.panel-tip-anchor` (zero on the last), so rows pitch 24.8 px as in the source (y 211/235.8/260.6/285.4). Scoped to the panel's own classes.
- P2 [applied] Content offset: `.panel-resizer` is now an in-flow 3 px flex item (`position: relative; flex: none`), so cards start 3 px further right (source cards x 1173.8); the indicator keeps `margin-left: -12px`.
- P3 [applied] Inspector header: `.panel-heading` has no min-height and `padding-bottom: 8px`; `.panel-pencil` is 20 px tall (svg 16), so the h1 is at +0 and the pencil centred on it (source total 33.2, margin-bottom 16).
- P4 [applied] Display pill: `.card-roll-up-right .available-pill { pointer-events: none }` and no `title` in `display` mode (source: disabled button, title ""). The grid's pill is untouched.
- P5 [applied] Tooltip offset: `top: calc(100% + 8px)` (source 8 px below the row); the margin sits outside the anchor's box so 100% is the row's bottom.
- P6 [applied] Card bodies: bottom padding 24 px (16 + the source's 8 px breakdown margin) for the summary and Available Balance cards.
- P7 [applied] (a) New full-bleed `CardChevronDownIcon` / `CardChevronRightIcon` used only by `PanelCard`; the grid's chevrons are unchanged. (b) `PencilIcon` redrawn to fill its 16 px box. (c) The pencil's native title is replaced by `PanelTooltip` with `align="end"` (right-aligned, 8 px below, same delay); aria-label kept.
