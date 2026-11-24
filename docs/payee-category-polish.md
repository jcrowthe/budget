# Payee category UI (EXF-515, U4): polish list

Not compared with the source: the ticket's screenshots are not in the repo. Every item copies Budget's own `Payee Name` and `Renaming` cards and the `Transactions` popover; scoped to `.mp-categorization` and `.mp-recent` in `manage-payees.css`, colours only from `tokens.css` or the file's `--mp-*` locals.

- P1 [applied] Card frame, heading and error bar are the `.mp-card`, `.mp-card h2` and `.mp-error` of the other cards; the error bar is rounded on all corners and 8px under the options.
- P2 [applied] Option labels `--labelPrimary` 500, 8px apart; body text `--labelSecondary`, indented to the label; the current default in `--labelPrimary` 500.
- P3 [applied] Radios use the native control with `accent-color: --actionPrimary`; unchecked radios take `tabindex="-1"` so Tab stops once on the group.
- P4 [applied] The combobox is the register's `CategoryField`, `max-width: 100%`, no fixed width; its list is raised above the dialog's backdrop (`z-index: 71`).
- P5 [applied] The popover is the `Transactions` popover's frame (arrow, head, `.mp-table`, primary `Close`), 420px wide at most and 16px inside the dialog; it opens above the link when there is no room below (arrow down).
- P6 [applied] The popover's header cells are plain (no sorting); the first column has no left padding and the last no right padding.
- P7 [not compared] Empty state `No transactions yet.` is ours.
- P8 [not compared] The card's order, `Payee Name`, `Categorization`, `Renaming`, is the Architect's (docs/manage-payees-design.md).
