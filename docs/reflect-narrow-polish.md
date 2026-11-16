# Reflect narrow window: polish list

- P1 [applied] Income / Expense section toggles: `.ie-heading .ie-toggle { gap: 6px; line-height: 1.2; vertical-align: top }` and `.ie-heading .ie-toggle svg { margin-left: 2px }` (income-expense.css), so the "p" descender is no longer clipped by `.ie-label`; values follow the source's measured 21.6px line, caret x 302.
- P2 [applied] `title` only on shortened first-column labels: static `title` props dropped; a layout effect in `Table` sets/removes it by `scrollWidth > clientWidth`. Narrow spec acceptance 2 and the design doc (Approach, Acceptance 2) changed to "title equals the text when shortened, absent when not".
