# Register: approve, reject, attention and the banner (polish list)

Designer's list, measured against the source in dark. Status set by the step that applied it.

- P1 [applied] The attention column (col, th, cells, the extra colSpan, the entry row's cell and split `lead`) is rendered only when a listed row is unapproved (source: display:none otherwise). `AttentionColumnContext` carries it to `EntryRow` and `ScheduledSection`. The departures in `all-accounts.spec.ts` and `register.spec.ts` are reverted (their seeds have no unapproved row); `register-attention-narrow.spec.ts` seeds unapproved rows.
- P2 [applied] `col-attention` 26px; the header keeps its 1px right border. The two extra px come out of payee/memo's percentages as before; CATEGORY stays ≥ 88px at 1024px in every state (spec).
- P3 [applied] Header icon is the filled `InfoCircleFillIcon`, 14x16, top 1px, `--labelTertiary` (#9b9caa, same value as the source's --iconFillPrimary).
- P4 [applied] `.attention-button` 16x16, margin-top 3px, icon 14x14, `--register-label-action`.
- P5 [applied] `.needs-category` 24px high, line-height 22px.
- P6 [applied] Banner `--register-banner-bg` #292c6c, 8px 16px padding (48px), 16px/400, 6px text margins, whole banner turns the filter on, hover #545bfe with View #7583ff (`--register-primary-active`, a register token); View 32px, radius-lg, 16px/500, min-width 84px.
- P7 [applied] Approval popover 320px, `bodyClass` `is-approval` (16px padding, stacked full-width 32px primary buttons, 8px gap); `Popover` gained `align="start"` (this use only) so the panel starts at the icon and stays clear of the sidebar. Roles, labels and the disabled Reject title kept; the disabled Reject is drawn at 50% opacity.
- P8 [applied] The Approval popover's panel has radius 4px (`--radius-xs`, source `.modal-account-dropdown .modal`), scoped to `.bulk-popover-body.is-approval`; the shared `.bulk-popover-body` is unchanged.
