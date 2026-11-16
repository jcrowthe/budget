# Scheduled transactions polish (EXF-497, EXF-499)

- P1 `.register-table .col-date`: 96px again on every register, as in the source (measured on the date cell, All Accounts, dark theme). 112px only under `.register-table.has-scheduled`, which RegisterTable sets when it shows scheduled rows (a repeating row needs about 100px; width with scheduled rows is not compared, the source has none). [scoped]
