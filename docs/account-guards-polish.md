# Account guards polish list

- [applied] P1 · All Accounts with no open account: Add Transaction and File Import are disabled and Shift+N opens no row. `useOpenAccounts` (register/openAccounts.ts) is shared by Register and RegisterTable; disabled only once accounts have loaded. Checked in e2e/account-guards.spec.ts.
- [applied] P2 · Undo and Redo in the register toolbar are `disabled` until EXF-530 wires them; colour and cursor come from the existing `.toolbar-button:disabled`.
