# Accounts polish (EXF-481)

Applied from the Designer's measured list. All changes are scoped to `.account-modal`, `.nav-account-*` or the account page.

- P1 [applied] Back/Close icons use `--actionPrimary` (`.account-modal .icon-button`).
- P2 [applied] 1px `--borderSubtle` under the modal header (`.account-modal .dialog-head`).
- P3 [applied] `.dialog-backdrop.top` centres the modal in the padded box; only AddAccountDialog uses `.top`.
- P4 [applied] `.dialog.account-modal` is 14px/500, line-height 1.2; inputs inherit; the select stays 400.
- P5 [applied] Intro margin `0.3rem 0 16px`; `strong` weight 600.
- P6 [applied] Labels margin 0 0 4px, padding `0.3em 0 0.1em`; fields margin-bottom 4px.
- P7 [applied] Input padding 4px 16px, select 0 16px; caret svg 16px with 3.2px padding.
- P8 [applied] Group header 32px flex row, left padding 28px, `--labelPrimary`; group padding-top 8px; list margin-top 0.
- P9 [applied] Row margins and padding (left 32px, right 36px) leave room for EXF-483's pencil and status icon.
- P10 [applied] Negative balance is `--labelNegative` text on no fill. This corrects the design doc's "red pill".
- P11 [applied] Account page uses its own `.account-header` (name, badge below, 1px rule); `PageHeader` untouched.
- P12 [applied] Balances are a flex row of amount over label with `+` and `=` operators; the label texts and `formatMoney` amounts are unchanged. Amounts use `--statusPositive` for all values (negative colour not observed).
