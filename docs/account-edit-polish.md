# Account edit polish (EXF-486, EXF-488)

Measured values are the source's closed-account Edit dialog (dark theme, 1600×813); see docs/account-edit-design.md.

- P1 [applied] Header X: 16×16 button, padding 0, 16 px svg, `--actionPrimary`, `title="Close"` on both dialogs; scoped to `.dialog.form.edit-account` (global `.icon-button` untouched).
- P2 [applied] "Account Information": 600 `--font-size-md`, `--line-height`, padding-bottom `--space-1`, margin-bottom 11.8px.
- P3 [applied] Spacing: input margin-top `--space-2`, fields margin-bottom 15px (error bar's pull-up adjusted to match); scoped. Balance input and helper keep the same rhythm (not visible in the source).
- P4 [applied] Textarea: `height: auto`, min-height 32px, `--line-height`, so rows=2 gives about 43.6px.
- P5 [applied] Field weight 500 via `.dialog.form.edit-account .field`.
- P6 [applied] Textarea focus border `--actionPrimary`; the nickname keeps `--buttonPrimaryBackground`.
- Note [declined] Light theme: the clone has no light tokens anywhere, so nothing to do in this feature.
