# Bank link screens polish (EXF-461)

Not compared with the source (forbidden by the design); checked against the clone's own dialogs.

- P1 [applied] Bank Connection buttons (Sync Now, Unlink Account, Link Account) now use the dialog's secondary button look (`.dialog.form.edit-account .form-body .secondary` in `edit-account.css`), with hover and a 0.5-opacity disabled state.
- P2 [applied] The disabled Account Type select of a linked account now wins on specificity (`.dialog.form.edit-account select.field:disabled`): `--labelSecondary`, default cursor.
- P3 [scoped] The Account Details type select inherits the app font at weight 400 (`.bank-link-body select.account-field` in `bank-link.css`); the global rule is untouched.
