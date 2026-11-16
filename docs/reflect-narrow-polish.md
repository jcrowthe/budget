# Reflect narrow window: polish list

- P1 [applied] Income / Expense section toggles: `.ie-heading .ie-toggle { gap: 6px; line-height: 1.2; vertical-align: top }` and `.ie-heading .ie-toggle svg { margin-left: 2px }` (income-expense.css), so the "p" descender is no longer clipped by `.ie-label`; values follow the source's measured 21.6px line, caret x 302.
- P2 [applied] `title` only on shortened first-column labels: static `title` props dropped; a layout effect in `Table` sets/removes it by `scrollWidth > clientWidth`. Narrow spec acceptance 2 and the design doc (Approach, Acceptance 2) changed to "title equals the text when shortened, absent when not".

## Apply polish, round 2 (Designer, dark, measured live in the source)

- P1 [applied] Income v Expense first column: `ieWidths` uses `F = FIRST_MIN (96)` instead of the measured label width; `FIRST_MAX` and the `needs.first` measurement are dropped. Labels that do not fit keep the ellipsis and the tooltip on shortened labels only. The narrow spec no longer requires nine labels to be whole at 1024×700 (shortened labels still need an ellipsis and `title = text`); the 1440×900 checks stay. `docs/reflect-narrow-design.md` (Approach, Acceptance 2) updated.
- P2 [applied] Income / Expense heading caret: `.ie-heading .ie-toggle svg { margin: -2px 0 0 2px }`, and the fixed `height: 39px` on `.ie-heading th/td` removed so the row takes its natural 38.6px (source `.income-expense-h1 button`: caret top row + 14.0px, row 38.6px).
