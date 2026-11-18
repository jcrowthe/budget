# Manage Payees (EXF-510): polish list

All items are scoped to the feature (`apps/web/src/payees/manage-payees.css` and its components); `global.css` and `tokens.css` are untouched.

- P1 [applied] Done and the popover's Close use the feature-only `mp-primary` instead of the global `.primary` (no margin-top, 32px high); the footer is 65px.
- P2 [applied] The dialog's dividers (head, left pane, footer, card heading) use `--borderSubtle`; the popover table keeps `--separatorStandard`.
- P3 [applied] Search: 16px magnifier in `--labelTertiary`; clear button 32×32, `--labelTertiary`, 16px filled close-circle; right padding only with `.has-clear-button`.
- P4 [applied] `.mp-body` is 500 / line-height 1.5 once.
- P5 [applied] Card and transfer headings use local `--mp-label-heading` (#f1f1ff).
- P6 [applied] Payee Name input and New payee select use `--inputBackground`.
- P7 [applied] Destructive hover uses local `--mp-destructive-hover` (#912333).
- P8 [applied] Dimmed cards 0.3; `New payee` h3 14px/500, margin 4.8px 0; the sentence is an italic 12px `<em>`; Cancel/Delete flush left with 16px vertical padding.
- P9 [applied] Popover content padding 1.6px 8px 4px; header padding 16px 0 0; table 7px below the title.
- P10 [applied] Header labels `--labelPrimary`; right border between header cells except the last.
- P11 [applied] No left padding on the first column, no right padding on the last.
- P12 [applied] The table scrolls inside a 192px box (sticky header) with a bottom border and none under the last row; Close is the primary button, 16px.
- P13 [applied] Checkbox squares 13×13, tick and dash images scaled to 10px.
- P14 [applied] Border above `Select N Unused Payees` removed.
- P15 [applied] Disabled in-pane buttons: `--menuHover` background, `--labelTertiary` text, full opacity; footer Undo/Redo keep opacity 0.5.
