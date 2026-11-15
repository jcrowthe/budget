# Scaffold polish list

Source measured by the Designer (YNAB Test Budget plan, dark theme, 1440×900). All values come from that measurement.

- [applied] P1 `.nav a` padding 0 8px, gap 8px: icon at x=16, label at x=48.
- [applied] P2 accounts card margin, h5/p margins, Add Account margin; tokens `--space-card`, `--space-half`.
- [applied] P3 `--line-height: 1.2` set on `.app` (global to the shell on purpose, the source differs everywhere).
- [applied] P4 `--font-size-month: 21px` on `.page-header.plan h1` only.
- [applied] P5 `.page-header` padding 0 16px.
- [applied] P6 Reflect title styled as the active tab (18px/600, 4px `--actionPrimary` bottom border), reflect variant only.
- [applied] P7 (a)–(h): menu position/padding, inset radius-4 items, leading icons, chevron svg, submenu at the row's top with max-content width, "Recent Plans" heading, document icons, current plan not listed and no ✓, `--menuHover` while the submenu is open.
- [applied] P8 New Plan dialog via the `.dialog.form` variant: 480px, 48px header, "Plan Name" label, 32px input focused on open, Cancel + Create Plan footer; tokens `--buttonSecondaryBackground`, `--buttonSecondaryLabel`. The Add Accounts modal is unaffected.
- [applied] P9 Add Accounts via `.dialog.modal` + `.dialog-backdrop.top`: 360px, top-aligned, 70px header with centred title, 24px X icon; `--overlay` is now rgba(0,0,0,.33). The close button keeps `aria-label="Close"`.
- [applied] P10 Filled caret, plus-circle and nav icons (own artwork); `background-color .15s` transition on `.plan-button` and `.add-account`.
- [applied] P11 `.nav` margin-bottom 4px (card at y=204.4, Add Account at y=320.3) and `.accounts-card` right margin 10.4px + 3px resizer token (card 235.2px wide); plan button, nav links and Add Account untouched.
