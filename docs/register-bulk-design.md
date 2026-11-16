# Register selection, action bar and flags: design (EXF-520, EXF-522)

One Build, two tickets. **EXF-520**: selecting rows, the floating action bar and its More menu (Selected Total, Approve,
Reject, Categorize, Flag, Clear / Mark as Uncleared, Duplicate, Memo, Move to Account, Export, Delete), their keys,
`POST .../transactions/bulk`, `GET .../transactions/export`, and the tools `bulk_update_transactions` and `delete_transactions`.
**EXF-522**: a nullable `flag_color`, the flag cell and menu, `shift+F`, `PATCH` with `flag_color`, the bulk op `flag`,
and `flag_transactions`. Before this Build the register cannot delete a transaction; this Build adds that.
Spec: [register-bulk-spec.md](register-bulk-spec.md).

## Source

The notes, with the CSS values verbatim, and 21 cropped captures are at `/workspace/scratch/source/register-bulk/notes.md` (`01`–`21-*.png`).
They come from the test plan's All Accounts register (dark, at the window as found). Key facts:
- **Selected Total** shows only with **2 or more** rows selected.
- **The action bar** is `#383ca3`, radius 12, centred over the register 48px above its bottom. Categorize shows when at least one row takes a category.
- **More** for one row: Mark as Uncleared / Match and Unmatch (disabled) / Duplicate / Make Repeating (**one row only**) / `Memo...` / Export / Delete.
- **The Memo dialog's** Update button is disabled while the input is empty.
- **The flag menu** opens below the cell and shows six pills with key caps and "Edit Flags".
- **The bar covers the last row** at that window.

**Not seen**, and taken from the tickets: the Clear button, Approve and Reject, transfer and split rows, a flagged row and
"Clear 0", **Move to Account** (never offered in All Accounts), the Export dialog, the delete prompts, and every action's result.

## Approach: Worker

- **Migration `20261116101000_transaction_flags.sql`**: `ALTER TABLE transactions ADD COLUMN flag_color TEXT;`.
  It is nullable, with no default and no CHECK: no row is rewritten. Zod checks the values `red orange yellow green blue purple`.
  Split lines stay `NULL`, and no query that sums or counts transactions reads the column.
- **Reads** return `flag_color` everywhere: `transactionToApi`, and so `logShape`, history and every tool.
- **PATCH with only `flag_color`** goes to a flag path. It writes the flag and `updated_at` and one history row. It does **not**
  approve the row and **is allowed on a reconciled row**. With other fields alongside, the normal edit runs with its rules and sets the flag too.
- **`POST /budgets/{budget_id}/transactions/bulk`** takes `{ ids: 1–100, op, value?, confirm_reconciled? }`. The service is `services/transactions-bulk.ts`.
  It reuses the single-edit planner: `prepare` is exported from `services/transactions.ts`, and the statement
  building leaves `mutate` for `planWrites`, which `mutate` keeps calling. So a bulk edit follows the rules of `PATCH`/`DELETE` exactly.
- **All or nothing, in one D1 batch.**
  1. Read every row needed: the selected rows, their lines, and the other sides of their transfers.
  2. Plan every row; the first rule broken refuses the whole request, with nothing written.
  3. Write one batch, with logs first and then writes:
     - every `change_log` row is guarded by a **snapshot guard**: each row read still has its read `updated_at` and is not deleted;
     - the first transaction write has the same guard;
     - every later write is guarded by "the first write's row has `updated_at = now`".

  A D1 batch runs alone and rolls back on any error, so either every statement applies or none does. If the guard fails (a race),
  the service reads again, up to 3 attempts, then answers 409 `conflict`. The snapshot guard binds a single JSON parameter
  (`json_each`), so it stays under D1's 100 bound parameters a statement.
- **Limits.** At most 100 ids, the same as approve and reject: every id is read first and one batch holds every statement.
  A plan over **400 statements** (for example, many large splits duplicated) is refused with 422 `too_many_changes`
  "Select fewer transactions: this change is too large for one request". This keeps one request within D1's per-invocation query limit.
- **Skipped versus refused.**
  - **Skipped** (left alone and reported with a reason) when the row's *state* means the op does not apply: it is reconciled (every op except
    flag and delete), it already has the value (`unchanged`), or it takes no category (categorize).
  - **Refused whole** when the *value or combination* breaks a rule: an unknown id, an unusable target, or any refusal the single edit
    would give. The error `detail` starts with `Transaction <id>: `.

| op | value | effect | skipped | refused whole |
|---|---|---|---|---|
| `clear` / `unclear` | – | `cleared`; single-edit rules (row approved, split lines follow; a transfer's other side keeps its own) | reconciled; `unchanged` | – |
| `categorize` | category id or `"ready_to_assign"` | category / Inflow: Ready to Assign; row approved | reconciled; `split` parent; `tracking_account`; on-plan transfer `category_not_needed`; credit `starting_balance`; `unchanged` | unknown category (422) |
| `memo` | string ≤500 or null | memo (trimmed, `""` → null); the transfer's other side follows | reconciled; `unchanged` | other side reconciled (409) |
| `move` | account id | account; every other field kept (cleared, import fields, flag); row approved | reconciled; already there | unknown target (422); closed target (422 `account_closed`); a transfer whose other side is in the target (422); both sides of a transfer in one request (422); a categorized row or a split into a tracking account (422 "…: <target> is a tracking account: its transactions take no category"); credit Starting Balance (409) |
| `duplicate` | – | a new row in the same account | – | the account is closed, or the transfer's other account is (422 `account_closed`) |
| `delete` | – | soft delete; a transfer's other side goes too; a split's lines go; each deleted imported row (either side) gets a `deleted` tombstone | – | a reconciled row, or a reconciled other side, without `confirm_reconciled: true` (409 `transaction_reconciled`) |
| `flag` | colour or null | `flag_color` of the selected rows only (a transfer's sides are separate; lines never) | `unchanged` | – |

- **Duplicate.** The copy keeps the account, date, payee (id and name), category, Ready to Assign flag, memo, amount and
  `cleared` (a reconciled row's copy is `cleared`). It is `approved: true`, with no import fields and no flag, and new timestamps.
  A split copies its lines with new ids. A transfer becomes a **new pair** (the copy plus `newOtherSide`, uncleared like
  `create_transfer`); with both sides selected, one pair is made. Delete with both sides selected deletes the pair once.
- **Answer**: `{ data: { op, changed, skipped: [{id, reason}], others, copies: [{id, copy_id}], transactions } }`.
  `changed` lists the requested ids that changed, in the order given. `others` lists the other sides that changed with them.
  `transactions` holds the rows after the change: the copies for duplicate, the rows as they were for delete.
  History gets one `change_log` row per transaction written, with the actor.
- **Export** `GET /budgets/{budget_id}/transactions/export?ids=a,b` (1–100), registered **before** `GET …/{transaction_id}`.
  It answers `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="Selected Transactions for <Plan> as
  of YYYY-MM-DD HH-mm.csv"` (UTC). The pure `registerCsv` (`packages/schema/src/register-export.ts`) writes a BOM and the ticket's
  header, then one line per row in the ids' order (a split: one line per line, memo `Split (i/n) <memo>`). Formats: Date
  `MM/DD/YYYY`; Outflow and Inflow `$1234.56`; Cleared `Cleared`, `Uncleared` or `Reconciled`; Flag the colour's name or empty.
- **MCP.** `bulk_update_transactions` (ops `clear unclear categorize memo move duplicate`), `delete_transactions` (`ids`,
  `confirm_reconciled`) and `flag_transactions` (`ids`, `color` or null) all call the bulk service. Coverage:
  `POST …/transactions/bulk → [bulk_update_transactions, delete_transactions, flag_transactions]`. Export is
  `{ excluded: "a CSV file download for the browser; an agent reads the same rows with list_transactions and get_transaction" }`.
  `update_transaction` gains `flag_color` (through `transactionUpdateShape`), and the read tools list `flag_color`. The descriptions
  give each op and its value, the 100-id limit, all-or-nothing, the skips, and that **a delete removes both sides of a transfer and a
  split's lines and cannot be undone through the API** (`MONEY`, `timestamps`, `dates`).

## Approach: web

- **Selection** moves from `RegisterTable` into `register/selection.tsx` (`SelectionProvider`, `useSelection`). The account
  page and the All Accounts page wrap their header and register in it, keyed `<budgetId>:<accountId|all>`, so changing the account or plan clears it.
  Ids that leave the list drop out.
  - A checkbox toggles its row. A row click selects only that row; on the only selected row it edits it, as today. A reconciled row is only ever selected.
  - `ctrl+A` / `⌘A` outside a field selects all. Escape clears the selection when no menu, dialog or entry row is open.
  - A split's line rows follow their parent and cannot be selected alone.
- **Selected Total** (`SelectedTotal`, placed at the right end of `BalanceRow` by both headers): with 2 or more rows selected, it shows the signed sum of the selected rows'
  `amount` (`formatMoney`, negative style when below 0) over "Selected Total (N)".
- **Action bar** `register/ActionBar.tsx`:
  - Position: fixed, centred over the measured `.register` box, 48px from the bottom.
  - Content: `× N Transaction(s)` (clears the selection) | Approve (any unapproved row), Reject (every row an unapproved
    non-transfer import), Categorize (at least one row takes a category), Flag, Clear (some non-reconciled row uncleared;
    title "Toggle cleared state") | `More`.
  - While the bar shows, `.register` gets `padding-bottom: 112px`, so the last row can scroll clear of it (AC13).
- **More menu** `register/MoreMenu.tsx`, in the source's order and dividers:
  Mark as Uncleared (every non-reconciled row cleared) / Match and Unmatch (disabled, `data-ticket="EXF-464"`) / Duplicate /
  Make Repeating (one row only, disabled, `data-ticket="EXF-503"`) / `Memo...` / **Move to Account › (one account's register
  only**, as the source never offered it in All Accounts; the submenu lists the other open accounts in sidebar order) /
  Export N Transaction(s) / Delete.
- **Keys** act only when all of these hold: rows are selected, focus is not in an input, textarea, select or contenteditable, no `aria-modal` is open, and no entry row is open.
  Each key acts only when its button or entry is shown and enabled.
  `C` Clear or Mark as Uncleared, `K` Categorize, `A` Approve, `shift+R` Reject, `shift+D` Duplicate, `shift+F` the flag menu,
  `Delete`/`Backspace` Delete; `M`, `shift+U` and `shift+T` do nothing.
- **Categorize.** With one row, it opens the row in edit mode with the category picker open (the existing `openCategory`). With several rows,
  it opens a category list anchored to the button: the register's `CategoryField` list for the current month, with no split footer.
  Picking an entry sends `categorize`.
- **Flag cell**: a new 42px column after the checkbox (empty in the entry, split and line rows). Unflagged: an outline flag,
  `aria-label="Flag"`. Flagged: the filled flag on a 30% pill, `title` and `aria-label` the colour's name. A click opens
  `register/FlagMenu.tsx` for that row (`PATCH`). The menu (`role="menu"`) lists "Clear" [0] (only when a target row is flagged),
  then Red [1] … Purple [6], an hr, and "Edit Flags" drawn disabled (`data-ticket="EXF-480"`). A digit picks while it is open.
  Opened by `shift+F` or the bar's Flag button, it sits above that button and flags every selected row (bulk `flag`).
- **Memo dialog**: the source's. Update is disabled while the input is empty, so clearing memos is API-only.
- **Export dialog** `register/ExportDialog.tsx` (Reflect's idea, its own file): "Export Transactions", the ticket's text,
  "Don't show again", Cancel and Export. "Don't show again" is remembered per plan in `ui-state` under the new key
  `hide_register_export_dialog` (`packages/schema/src/ui-state.ts` takes new keys). The file is named with the local time.
- **Delete** uses `deleteConfirm(rows)` (pure):
  - **No prompt** when no row is reconciled, no loaded other side is reconciled, and the selection is one row or holds no transfer.
  - **One reconciled row**: "Delete Reconciled Transaction?" / "Deleting a reconciled transaction will bring the reconciliation out of balance." / Delete, Cancel.
  - **Otherwise**: "Delete N Transaction(s)?" with, in order:
    - "Deleting a transfer transaction will delete the transfer in both accounts." when a transfer is selected;
    - the reconciled sentence when a selected row is reconciled (our combination; the ticket does not cover this case);
    - "Some matching transfers in other accounts have been reconciled. Deleting these transactions could bring those account's
      reconciliations out of balance." when another side is reconciled.
  - The confirmed request carries `confirm_reconciled: true`. If the server answers 409 `transaction_reconciled` (the other side was not loaded), the dialog
    opens with the matching sentence and the request goes again after the confirm.
- **Errors**: a refused request shows its `detail` in a `role="alert"` line above the bar until the next action or Escape.
- **Note 9 chore**: `api/accounts.ts` re-exports `localToday` from `./today` and drops its copy. `shell/AddAccountDialog.tsx` is **not**
  touched: its import keeps working through the re-export, and pointing it at `../api/today` takes a second import line, more than
  the one-line change the note allows. No shared module changes.
- **Icons and custom properties** are listed in the spec. The icons are our own SVGs, and every colour is a `register.css` custom property taken from the notes.

## Downstream effects

- Every transaction read, tool result and history row gains `flag_color` (null by default).
- The flag column shifts cells right by one. `all-accounts.spec.ts`, `register.spec.ts` and `register-entry.spec.ts` move their positional cell indices by one.
- `insertIfStmt` writes the new column last, so the bank sync's inserts write `NULL` there without an edit to the sync.
- `TransactionRefused` also allows status 404, so a bulk "not found" can name the id.

## Out of scope and known issues

- **Out of scope:**
  - Match and Unmatch (EXF-464) and Make Repeating (EXF-503): drawn disabled.
  - Flag names and the "Edit Flags" dialog (EXF-480): drawn disabled.
  - "Show Flags" (EXF-529): the column is always shown.
  - Undo (EXF-530), sorting by flag, shift-click ranges, and the light theme.
- **Known issues:**
  - **A delete cannot be undone** until EXF-530. An ordinary delete has no prompt (the source's behaviour), so it is final.
  - Not compared, because each needs a change in the test plan: the mixed-selection Clear choice, the Move submenu, the Export dialog and file, the delete prompts, and every action's result.

## Acceptance

Each case names its ticket. Browser cases click with the real mouse (`realClick`, `e2e/support/register-seed.ts`) on a plan the spec makes. **Compare** cases are judged against the source's All Accounts register of the test plan (dark, at the window as it is),
by ticking boxes and opening menus only.

1. (EXF-520 AC1) In an account with rows +$250.00 and -$4.50, tick both boxes. The bar reads "2 Transactions" and the strip shows
   "$245.50" over "Selected Total (2)". With one ticked, the bar reads "1 Transaction" and there is no Selected Total.
   Compare: tick two rows in the source; check the bar's shape, colour and place, and the total's place.
2. (EXF-520) A click on a date cell selects only that row. The header box is mixed when some rows are ticked and checked when all are. `ctrl+A` selects all;
   Escape clears. Leaving for another account and coming back shows nothing selected.
3. (EXF-520 AC2) In an account with a cleared +$655.50 and uncleared -$100.00 and -$60.00, select the two uncleared rows and press `C`.
   The strip goes from $655.50 + -$160.00 = $495.50 to $495.50 + $0.00 = $495.50. Press `C` again (More shows "Mark as Uncleared"):
   both are uncleared again. Not compared: needs a change in the test plan.
4. (EXF-520 AC3) With two rows selected, More › `Memo...`: the dialog is "Edit Memo (2 Transactions)" and Update is disabled while the input is empty. Type "x",
   click "Update 2 Transactions": both memos are "x" after a reload. Compare: the source's dialog (open, then Cancel).
5. (EXF-520 AC4) A cleared row, `shift+D`: a copy with the same date, payee, category, memo, amount and cleared state appears and
   is the selected row. Not compared.
6. (EXF-520 AC5) In an account register, More › Move to Account › the other account: the row leaves this register, and both
   accounts' sidebar balances change by its amount. All Accounts' More has no Move to Account. Not compared.
7. (EXF-520 AC6, EXF-522 AC5) Flag one row Red, select it and another, then More › Export 2 Transactions › Export. The file is named
   `Selected Transactions for <plan> as of <local YYYY-MM-DD HH-mm>.csv`. Line 1 is the ticket's header, and the red row's Flag field is
   `Red`. With "Don't show again" ticked, the next export downloads with no dialog. Not compared.
8. (EXF-520 AC7) Delete removes an ordinary row with no prompt, both by the key and by the menu. Then a row the spec shows as reconciled: `page.route` rewrites the list answer, because no API makes a reconciled row and a spec never writes the database.
   The "Delete Reconciled Transaction?" dialog shows first. Cancel keeps the row; Delete sends `confirm_reconciled: true`. Not compared.
9. (EXF-520 AC8) Worker: every op writes one `change_log` row per transaction written, with the actor (`user:…` over REST,
   `mcp:…` through tools). A skipped row writes none.
10. (Lead AC9) Delete one side of a transfer from the bar: both sides go and both balances follow. Worker: a deleted split leaves no
    live line. Worker with the Plaid stand-in: a bulk-deleted import leaves a `deleted` tombstone, and the next sync does not bring it back.
11. (Lead AC10) Worker: a duplicate of an unapproved import is approved, with null `import_id`, `source` and bank fields.
    A split's copy has equal lines with new ids. A transfer's copy is a new pair linked both ways.
12. (Lead AC11) Worker: an unknown id (404), `move` to a closed account (422 `account_closed`), `move` of a transfer into its
    other account (422), `move` of a categorized row to a tracking account (422), and `delete` of a reconciled row without the
    confirm (409) each write nothing and name the id. `clear` with a reconciled row changes the others and reports it as skipped
    (`reconciled`); `categorize` skips an on-plan transfer (`category_not_needed`). A forced race (a test hook changes a row
    between the read and the write) leaves every row unchanged.
13. (Lead AC12) With an unapproved import selected (made unapproved through `page.route`, as in case 8), Approve and Reject show,
    and Approve posts its id to `/approve`. With an approved row also
    selected, Reject is hidden. With only approved rows, neither shows. Not compared.
14. (Lead AC13) At 1024×700, with 25 rows and the bar shown, scroll the page to its end. The last row's checkbox and flag cell are
    topmost at their centres and take a real click.
15. (EXF-522 AC1) Click an unflagged row's flag cell: Red…Purple with keys 1–6, a disabled "Edit Flags", and no Clear.
    Compare: the source's flag menu (open it, then Escape).
16. (EXF-522 AC2) Pick Red: a red flag titled "Red". Reopen the menu: "Clear" 0 is listed first. Not compared.
17. (EXF-522 AC3) Select a row, press `shift+F`, then `5`: Blue. Press `shift+F`, then `0`: no flag. The bar's Flag button opens the same menu.
18. (EXF-522 AC4) The flag survives a reload. `GET …/transactions/{id}`, `list_transactions` and `get_transaction` return
    `flag_color`. `flag_transactions` sets and clears it. A flag-only PATCH works on a reconciled, unapproved row and keeps it unapproved.
19. (Lead) The More menu for one row: Mark as Uncleared / Match (disabled) / Unmatch (disabled) / Duplicate / Make Repeating
    (disabled) / Memo... / Export 1 Transaction / Delete. With two rows, Make Repeating is absent. Compare: the source's More menu for
    one row and for all rows.

## Manifest

touches: [apps/worker/migrations/20261116101000_transaction_flags.sql, apps/worker/src/db/schema/transactions.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transactions-bulk.ts, apps/worker/src/services/transactions-export.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/test/transactions-bulk.test.ts, apps/worker/test/transactions-bulk-rules.test.ts, apps/worker/test/transaction-flags.test.ts, apps/worker/test/transactions-export.test.ts, apps/worker/test/mcp-coverage/transactions.ts, apps/worker/test/mcp-timestamps.test.ts, packages/schema/src/transactions.ts, packages/schema/src/register-selection.ts, packages/schema/src/register-export.ts, packages/schema/src/ui-state.ts, packages/schema/test/register-selection.test.ts, packages/schema/test/register-export.test.ts, apps/web/src/register/**, apps/web/src/api/transactions.ts, apps/web/src/api/accounts.ts, apps/web/src/account/AccountHeader.tsx, apps/web/src/account/account-header.css, apps/web/src/pages/account.tsx, apps/web/src/pages/accounts.tsx, e2e/register-bulk.spec.ts, e2e/register-flags.spec.ts, e2e/support/bulk-seed.ts, e2e/register.spec.ts, e2e/register-entry.spec.ts, e2e/all-accounts.spec.ts, docs/register-bulk-design.md, docs/register-bulk-spec.md, docs/README.md]
shared: []
migrations: 1

Beyond the Lead's list: `ui-state.ts` (the export key), `AccountHeader.tsx` and its CSS (the Selected Total), the two pages
(the selection provider), `transactions-export.ts` (the CSV service) and `e2e/support/bulk-seed.ts` (the seed).
`transaction-pairs.ts` and `transaction-splits.ts` are reused unchanged.
