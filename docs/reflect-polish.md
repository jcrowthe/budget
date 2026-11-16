# Reflect polish list (EXF-548, EXF-551)

Measured values come from the Designer's comparison with the source's Reflect pages (dark theme). All changes are
scoped to `apps/web/src/reflect/**`; nothing in the shell or `global.css` changed.

- P1 [applied] Tab bar: `--backgroundSecondary`, padding `0 0 0 16px`, 18px/600, inactive `--labelSecondary`, hover white, padding `20px 0 16px` with the 4px border; `--reflect-tab-bar` deleted.
- P2 [applied] Page padding 32px, header row (margin-top 24, height 32, margin-bottom 12), filter bar margin 16, body bottom 56, `font-weight: 500` under `.reflect`.
- P3 [applied] Export: 14/500, `--labelAction` (declared under `.reflect` and `.filter-popover`, not in tokens.css), 32px high, radius 8, 14px icon, hover and disabled colours.
- P4 [applied] Date pill: `--menuHover`, radius 8, 32px arrows with 12px chevrons and the stated padding, 16px separators as pseudo-elements, label 14/500 with 12px icon, hover `#7583ff45` scoped to `.reflect`.
- P5 [applied] Divider 1×16 with 8px margins, filter button restyled with an 8px caret, count pill per the source rule.
- P6 [applied] Date menu centred on the label button with a 30×15 up-arrow, 15px below, 240px wide, new item metrics; while Custom is open Custom is the checked item and the previous preset is not (the menu sits in a wrapper around the label button to centre it).
- P7 [applied] `.reflect-btn` sets `margin: 0` (fixes Apply and Done); Custom panel fields, selects and footer per the list.
- P8 [applied] Month grid opens below its select (the Start Date case). Deviation: when it would leave the window (End Date at 1024×700) it flips above its select, so a mouse can reach every month; current month is marked; circled year buttons.
- P9 [applied] Tooltip restructured (title, label rows with round swatches, 16/900 values), placed above the hovered point with a down-arrow. The e2e tooltip assertions now match label and value separated by whitespace.
- P10 [applied] Summary card: Net Worth row, then three 13rem columns; percent inline; zero change white; assets `#383ca3`, debts `--statusNegative`.
- P11 [applied] Line width 1, marker r 5, x labels white with a 6px tick, dashed baseline, zero line `--borderSubtle`, all-zero zero line at mid-height, chart height 320 (plot 300, axis 20, overflow visible).
- P12 [applied] Table as flex rows (Month flex 1, Net Worth content width, Monthly Change 11rem, 16px gap), header and body paddings, empty state 40px; info icon 12px. The elements stay `table/tr/td` so specs are unchanged.
- P13 [applied] Popover uses global tokens only (fixes the undefined `--reflect-pill`), centred with an up-arrow 15px below the button, new search field, rows, footer and links.

## Second pass

- Q1 [applied] The pill's button rules are scoped to its own controls (`.date-pill > .date-arrow`, `.date-pill .date-label`), so the Custom selects and menu items keep their own border, background and colour.
- Q2 [applied] The `#7583ff45` hover applies only to the pill's arrows and label and the filter buttons; menu items use `--menuHover`; a Custom select keeps its background and its border turns `--buttonPrimaryBackground`.
- Q3 [applied] Wrap margins dropped; separators are inside the arrows at their inner edges (left arrow 31px, padding 10/0/10/10; right arrow 32px); label radius 0.
- Q4 [applied] Month grid 240px; months block margin 4.8px 10px.
- Q5 [applied] Icon viewBoxes cropped to the glyph bounds (caret, both chevrons, calendar, Export document) and rendered at the measured sizes. In the Custom selects the CSS box stays 8×9 and the caret fits inside it.
- Q6 [applied] x label text 7px below the baseline; the plot starts 17px in when there are no y ticks.
- Q7 [applied] Popover search input height 32px; `.reflect-btn` line-height 19.2px.
