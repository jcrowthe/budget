# Register entry polish (EXF-517, EXF-507)

- P1 [applied]: entry inputs are 24px, padding 2.8px 4.2px, page background, 1px `--buttonPrimaryBackground` border, no focus shadow; picker fields (account, date, payee, category) get padding-right 16px and an 8px caret at right 5.4px, top 7px. Scoped to `.entry-input` / `.entry-picker`.
- P2 [applied]: action row 36px with right padding 37.6px; buttons 24px, padding 3.2px 17.6px, 14/500, radius 8px, 4.8px gap; Cancel transparent with a 1px `--actionPrimary` border, Save filled. The class is `.entry-button.is-primary`, so global `.primary` no longer leaks in.
- P3 [applied]: edit-row field cells have 1.6px padding on all sides (check and cleared cells keep theirs).
- P4 [applied]: calculator icon 16px in `--inputBorder` at left 3px, top 3px, opacity 0 until focus; an 18px left slot is always reserved so the text does not move.
- P5 [applied]: calendar rebuilt: `--backgroundTertiary`, no border, radius 0.4rem (as `.popover`), padding 12.8px, width 230, centred with a 30×15 arrow 15px below the field; 32px header with 16/600 title and 24px circled chevrons (`plan/monthNavIcons`, imported read-only) in `--register-label-action`; weekday row with rules; today filled with `--menuHover`, selected `--buttonPrimaryBackground`. The ring token is dropped from the design doc and `register.css`; e2e checks only the `is-today` class.
- P6 [applied]: list container is `--backgroundTertiary`, no border, radius 4px, `--shadowMenu`, width 320, centred with an arrow (down when above the field); create item is a bordered header block in `--actionPrimary` with a 12px plus icon; headings 12/600 normal case; option rows 28.8px with a 20px check slot and `--menuHover` highlight; body at most 210px with a 1px bottom rule; Manage Payees is a disabled text button (EXF-510).
- P7 [applied]: category list width 400 with the same container; zero Available is plain `--labelSecondary` text; positive and negative stay pills. Footer buttons are full-width secondary buttons; "Split" is now "Split (Multiple Categories)" and `e2e/register-entry.spec.ts` follows. "Payment/Transfer" stays (EXF-526), styled the same.
- P8 [applied]: with a value set and nothing typed, the category list starts with a "Selected" section holding the current category (checked, highlighted); it is also checked in its own group.

## Second round

- R1 [applied]: the field-cell padding rule is limited to `.entry-row`, so the action row keeps its 37.6px right padding (buttons end at the inflow cell's right edge minus 1.6px); padding 2.6px/0.6px puts the buttons 6.5px below the row top (source).
- R2 [applied]: the calendar's body has no padding-top and no bottom rule (`.entry-dropdown[role="dialog"]`), so the header sits 16px from the top.
- R3 [applied]: `Create "<text>" Payee` and the hidden-payee line are a fixed header block above the scrolling list (`header` on Dropdown/PickerInput): padding 12px 16px, line-height 16.8px, 1px rule below, still `role="option"` at index 0.
- R4 [applied]: the payee list's footer has no padding of its own and Manage Payees is as wide as its text with 16px padding; scoped by `:has(> [data-ticket="EXF-510"])` so the category footer keeps its 12px 16px.

## Shared category picker (EXF-589)

The category list of the Plan popovers (Assign, Move, Cover, Fix This, Delete Category) and of the register (entry row, split lines, payee categorisation) is one component, `CategoryList` in `apps/web/src/shared/picker/`, on `PickerInput` and `Dropdown` (same folder), with one stylesheet, `shared/picker/picker.css`. `plan/CategoryPicker.tsx` and `register/CategoryField.tsx` only filter, map values and set the field's text and footer. This supersedes the "Plan Categories" list and the Plan-only keys recorded in `categories-spec.md`, `rta-moves-spec.md` and `rta-moves-design.md`. Difference → winner → source:

| # | Difference | Winner | Source |
|---|---|---|---|
| D1 | Search: Plan matched category or group per row (RTA as "Inflow: Ready to Assign"); register matches a group name (whole group stays) or a row name | Register (`categoryMenu`) | register-entry-design.md, Category field |
| D2 | List shape: "Plan Categories" heading, bold groups, 24px indent, RTA row "Inflow: Ready to Assign"; register has Inflow → "Ready to Assign", 12/600 headings, 28.8px rows, check slot; listbox "Categories" | Register | P6 |
| D3 | Zero Available: grey pill vs plain `--labelSecondary` text | Register | P7 |
| D4 | Pill text tokens: `--categoryBalance*Label` vs `--backgroundPrimary`/`--labelPrimary` | Plan's tokens (same values in both themes) | tokens.css, theme-light.css |
| D5 | Highlight colour and hover: `--buttonSecondaryBackground` with a second CSS hover vs `--menuHover`, hover moves the one highlight | Register | P6 |
| D6 | Highlight on open: first row always vs none until typing or moving (the Selected row when a value is set) | Register | register-entry-design.md, Category field; P8 |
| D7 | "Selected" section | Register | P8 |
| D8 | ArrowUp/ArrowDown: wrap, opens and moves vs clamp, opens without moving | Register | register-entry-design.md, Keys in the row |
| D9 | Enter: picks whenever open vs only after typing or moving | Register | register-entry-design.md, Keys in the row |
| D10 | Tab: nothing vs picks the highlighted row after typing or moving | Register | register-entry-design.md, Category field |
| D11 | Escape: closes the list and stops vs passes on | Caller-owned (`escapeClosesList`; the Plan sets it) | rta-moves-design.md; categories-spec.md T11; register-entry-design.md |
| D12 | Blur and editing: list stays open, editing calls `onChange(null)` vs list closes, blur restores the shown value | Register | register-entry-design.md, Category field |
| D13 | Empty text: "No matching categories" vs "No categories found with that name." | Register | register-entry-design.md |
| D14 | Width and placement: inline, field-wide, max 240 vs body portal, 400, centred arrow, body max 210, flips | Register | P6, P7 |
| D15 | Highlight scrolled into view | Register | `PickerInput` |
| D16 | ARIA: `aria-controls` and `aria-activedescendant` (Plan) vs `aria-selected` = highlight and option `aria-label` (register) | Merged: all four | categories-spec.md T11; `PickerInput` |
| D17 | Field text after a pick: category name vs `<Group>: <Category>` | Caller-owned (unchanged) | EXF-589 |
| D18 | Field look: 32px, no caret vs 24px with caret | Caller-owned (unchanged) | EXF-589 |
| D19 | Field tooltip (`title` = the text) | Register | `CategoryField` |

Also fixed in `Dropdown`: scrolling inside the list no longer re-places it, and re-placing keeps the list's scroll position (before, a hover re-render of a long list jumped to the top, so a click landed on another row). `e2e/category-picker.spec.ts` runs one body in the Move popover and in the entry row, plus a dark/light contrast check.
