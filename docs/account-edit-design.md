# Account edit design (EXF-486, EXF-488)

The Edit Account dialog (nickname, notes, balance adjustment) and closing, reopening and deleting an account.
One design, one pull request. Spec: [account-edit-spec.md](account-edit-spec.md).

## Source

Study notes and captures: `/workspace/scratch/source/edit-account/notes.md` (Architect's box). Only the
**closed-account** variant of the dialog could be seen (the test plan's accounts are all closed); everything
else follows the two tickets, which were written from the live source.

Seen (closed account, dark theme, 1600×813):
- Overlay `rgba(0,0,0,.33)`; dialog 480 px wide, background `--backgroundTertiary`, radius 8, shadow
  `--shadowMenu`, no border. This is exactly the existing `.dialog.form` box of `NewPlanDialog`.
- Header 48 px, padding 16, bottom border `--borderSubtle`; title "Edit Account" 600 18 px; X is a 16 px icon in
  `--actionPrimary`, accessible name "Close".
- Body padding 16 16 0. Section heading "Account Information" 600 16 px; labels "Account Nickname", "Account
  Notes" 600 14 px. Input 32 px high, padding 4 8, background `--inputBackground`, border 1 px `--inputBorder`,
  radius 4, 500 14 px; focused border `--buttonPrimaryBackground` (input) / `--actionPrimary` (textarea), no ring.
  Textarea 2 rows (~44 px), resizable vertically. The nickname is focused on open.
- Footer padding 16, gap 8, buttons 32 px high, radius 8. Left: "Re-open" ghost (text `#a3acff`, 500 14 px,
  padding 4 8, hover background `--buttonSecondaryBackground`), then "Delete" disabled (background
  `--menuHover`, text `--labelTertiary`, 500 16 px, padding 6 16, arrow cursor). Right: "Cancel" (secondary,
  hover `rgba(117,131,255,.27)`), "Save" (primary, hover `--actionPrimary`). Save is enabled before any edit.
- Delete's tooltip is the native `title`; text in EXF-488. No app tooltip on any dialog control.
- Header pencil: tooltip "Edit Account" (already built). Sidebar row pencil: on hover, title "Edit Account".
- A closed account's page: Add Transaction, File Import and Undo are disabled.

Captures kept: `01-dialog-default.png`, `03-dialog-notes-focused.png`, `06-dialog-from-header.png`,
`hover-{reopen,del,cancel,save,close}.png`, `04-account-header-pencil-hover.png`,
`05-closed-account-toolbar-addtx{,-hover}.png`, all cropped (no sidebar).

Not compared (not visible in the test plan): the open-account dialog (balance section, Delete Account / Close
Account), the error bars, the "Close Account" dialog, every saved state. They are built from the tickets and
the look of the app's own dialogs (`NewPlanDialog`, `AddAccountDialog`).

Source study (Architect step): expanded the CLOSED group, hovered a closed account's row, clicked its pencil
(dialog opened), hovered the dialog's buttons, clicked into Notes without typing, left with Escape; opened that
account's page, hovered the header pencil and Add Transaction, clicked the header pencil, hovered the buttons,
left with Cancel; clicked "Plan" in the sidebar and collapsed CLOSED again. Nothing typed, nothing saved; the
plan menu, Bank Connections, Add Account, Link Account and other plans were never opened.

## Approach

Worker: extend `services/accounts.ts` with five use cases (rename/notes in `updateAccount`, `adjustBalance`,
`closeAccount`, `reopenAccount`, `deleteAccount`), each one guarded `db.batch` with its `change_log` rows, the
way `insertAccountWithStartingBalance` already writes the Starting Balance. New statements live in
`repositories/accounts.ts` (including the two on the `transactions` table: per-account transaction facts and
the soft delete of the Starting Balance). The transactions and payees files are only called
(`txRepo.insertIfStmt`, `txRepo.balancesByAccount`, `payeesRepo.findSystem`, `insertSystemIfMissingStmt`,
`systemIdSql`, `transactionToApi`), never edited. **No migration**: `note`, `closed`, `starred`,
`deleted_at` and `bank_account_id` exist; `can_delete` is derived.

Web: the dialogs live in `apps/web/src/account/` next to the header (they are account UI; the shell only mounts
them from the sidebar). The header pencil and the sidebar row pencil open the same `EditAccountDialog`.

## What changes

### API (all under `/api/v1`, `Idempotency-Key` accepted on writes)

| Operation | Body | 200 | Refusals |
|---|---|---|---|
| `PATCH /budgets/{budget_id}/accounts/{account_id}` | `{ name?, note?, starred? }` | `{ account }` | 422 `name_required`, 409 `name_taken`, 422 starring a closed account |
| `POST …/accounts/{account_id}/adjust-balance` | `{ balance, today? }` | `{ account, adjustment }` (`adjustment` null when unchanged) | 422 `account_closed` |
| `POST …/accounts/{account_id}/close` | `{ today? }` | `{ account, adjustment }` (null at zero balance) | — (closing a closed account returns it unchanged) |
| `POST …/accounts/{account_id}/reopen` | none | `{ account }` | — (an open account is returned unchanged) |
| `DELETE …/accounts/{account_id}` | none | `{ account_id, deleted_transaction_ids }` | 409 `has_transactions` |

- **Names**: trimmed; empty → 422 `name_required` "The account name is required."; another non-deleted account of
  the plan (closed included) with the same name ignoring case → 409 `name_taken` "This account name already
  exists." Renaming an account to a new case of its own name is allowed. Max 100.
- **Notes**: max 500; an empty or blank note is stored as null. Notes show only in the dialog.
- `balance` is the **signed working balance** as shown in the dialog (a card owing 150 is −150000), milliunits.
- `today` is `YYYY-MM-DD`; absent → the Worker's UTC date. The web app always sends its local date.
- Every account read (`list`, `get`, and every response holding an account) gains **`can_delete`**: an open
  account whose active transactions are none, or exactly one that is its Starting Balance (payee system
  `starting_balance`); a closed account with no active transactions. Transfers do not exist yet; when they do, a
  transfer into the account is one more transaction there, so the same rule refuses it.

### The adjustment transaction

| Field | Value |
|---|---|
| date | `today` |
| payee | the plan's system payee `manual_adjustment`, name "Manual Balance Adjustment"; created in the same batch when missing (as `starting_balance` is) |
| amount | new balance − current working balance (close: − working balance) |
| memo | null; "Closed Account" when made by close |
| cleared / approved | `cleared` / true |
| category | none; `inflow_to_ready_to_assign` = `on_budget` (Checking, Savings, Cash, Credit Card, Line of Credit → "Inflow: Ready to Assign"; Asset, Liability, loans → "Category not needed") |

No change in the balance → no transaction and no write. The register already labels a tracking account's row
"Category not needed" and an RTA inflow "Inflow: Ready to Assign"; system payees are already left out of the
payee picker (`payeeMenu` filters `system !== null`), so AC 486-12 holds without a payees change.

### Close, reopen, delete

- **Close**: one batch: the payee when missing, the "Closed Account" adjustment when the balance is not zero,
  and the account update `closed = 1`, `starred = 0`, **`bank_account_id = null`, `import_start_date = null`**.
  A linked account is therefore unlinked in the same batch by the same UPDATE that closes it; the connection
  read's `linked_account_id` (from `accountsRepo.linksForPlan`) becomes null. `account-links.ts` keeps its own
  link/unlink rules; it changes only to read `can_delete` (below). Linking a closed account is already refused.
- **Reopen**: `closed = 0`; the adjustment stays; the star stays off.
- **Delete**: refused with 409 `has_transactions` unless `can_delete`; otherwise one batch: soft delete (set
  `deleted_at`, `updated_at`) of the Starting Balance when there is one, and soft delete of the account with
  `bank_account_id`/`import_start_date` nulled (so a linked account is unlinked in the same batch). Month reads,
  `account-summary`, the plan-wide list and the sidebar all skip deleted rows already, so Ready to Assign drops by
  an on-plan cash account's starting balance and the Starting Balance row leaves All Accounts.
- **Concurrency**: every write is guarded on what was read (the account's name, note, starred, closed,
  bank link, and for money writes the account's active-transaction sum or its transaction set). A lost race
  writes nothing and retries up to 5 times, then 409 `conflict`. Rename guards also on "no other account has this
  name" inside the write.

### change_log (same batch, actor `user:…`/`service:…`/`mcp:…`)

| Use case | Rows |
|---|---|
| rename / note / star | one `update` row on `account`, before/after the account shape ("account renamed", "account note changed") |
| adjust-balance | `payee create` (if new), `transaction create`, `account update` with old and new balances ("balance adjusted") |
| close | as adjust when there is an adjustment, then `account update` whose `after` also carries `adjustment_id` (id or null) ("account closed") |
| reopen | `account update` ("account reopened") |
| delete | `transaction delete` for the Starting Balance (if any), `account delete` ("account deleted") |

### MCP tools (same services, same rows)

`update_account` (name, note, starred), `adjust_account_balance`, `close_account`, `reopen_account`,
`delete_account`. Descriptions use `MONEY` and `DATE` from `mcp/tool-text.ts`, say what they return, and
`delete_account` says it is refused (tool error with the 409 message) unless the only transaction is the
Starting Balance, or, for a closed account, there is none. Coverage lines in
`apps/worker/test/mcp-coverage/accounts.ts`:

```
"POST /budgets/{budget_id}/accounts/{account_id}/adjust-balance": { tool: "adjust_account_balance" },
"POST /budgets/{budget_id}/accounts/{account_id}/close": { tool: "close_account" },
"POST /budgets/{budget_id}/accounts/{account_id}/reopen": { tool: "reopen_account" },
"DELETE /budgets/{budget_id}/accounts/{account_id}": { tool: "delete_account" },
```
(`PATCH` keeps its existing `update_account` line.)

### Web

- **Edit Account** (`account/EditAccountDialog.tsx`, `role="dialog"`, `aria-modal="true"`, name "Edit
  Account"), on `.dialog-backdrop` + `.dialog.form` from `global.css`, its own rules in
  `account/edit-account.css`:
  - "Account Information"; "Account Nickname" (prefilled, focused); "Account Notes" (textarea, 2 rows).
  - Open accounts only: a divider, then "Working Balance" (on-plan) or "Today's Balance" (off-plan), an input
    prefilled with the signed balance without the currency sign (`250.00`, `-150.00`, `-180,000.00`), and the
    helper "An adjustment transaction will be created automatically if you change this amount."
  - Footer left: open → "Delete Account" when `can_delete`, else "Close Account" with `title` "Closing an
    account retains the transaction history for your plan. If you'd like to delete an account, start by closing
    the account first."; closed → ghost "Re-open" and "Delete" (disabled unless `can_delete`; when disabled its
    `title` is the EXF-488 text). Right: "Cancel", primary "Save" (always enabled).
  - Errors as a red bar under the field (background `--statusNegative`, white 14 px text): "The account name is
    required." (blank name, checked before any request; also on 422 `name_required`), "This account name already
    exists." (409 `name_taken`), "Enter an amount" (empty or unparseable balance, `parseAmountInput`). Nothing is
    sent while an error stands.
  - Save: nothing changed → close. Else `PATCH` (only the changed `name`/`note`) first, then `adjust-balance`
    when the balance text differs from its prefill and parses to a different amount. Then close; every query of
    the plan is invalidated (header, sidebar, register, Ready to Assign follow). If the PATCH fails nothing is
    saved; if the adjustment fails after a rename the rename stays and the message shows under the balance.
  - Cancel, X (aria-label "Close") and Escape close without a request.
  - Delete Account → `DELETE`, close, navigate to `/{budget}/accounts`. Re-open → `reopen`, close.
  - Close Account → balance 0: `close` at once and close the dialog. Otherwise the Edit dialog gives way to
    **Close Account** (`account/CloseAccountDialog.tsx`, same box): "Before you can close this account, the
    balance will have to be zeroed out. An adjustment transaction will be created for -$33.33." (amount
    `formatMoney(−balance)`), on-plan only an info box "The money in this account will be removed from your plan.
    If you would like to keep it in your plan, you can transfer it to another account before closing this one.",
    "Cancel" and primary "Adjust Balance & Close" (→ `close` with `today`, then close).
- **Mounting**: `AccountHeader`'s pencil (`data-ticket` removed) opens it for the page's account;
  `Sidebar.tsx` keeps an `editingId` and passes `onEdit` to `SidebarAccounts`, which already calls it.
- **Tokens** (`shell/tokens.css`): `--buttonGhostLabel: #a3acff`, `--buttonSecondaryBackgroundHover:
  rgba(117, 131, 255, 0.27)`. No new icon (`CloseIcon`, `PencilIcon` exist).

## Deliberate differences

- **Empty balance field**: the source treats it as 0 (wiping the balance with an adjustment); Budget refuses it
  with "Enter an amount" and saves nothing.
- The adjustment is dated the owner's local date (`today`).
- Delete on a closed account follows the ticket's API rule (no transactions at all), so the disabled Delete
  matches the source for any closed account that has history.

## Downstream effects

- `Account` gains `can_delete` (required): `e2e/sidebar-groups.spec.ts`'s fixture adds it; its "pencil … does
  nothing yet" test becomes "opens Edit Account". Change-log `after` of every account write gains `can_delete`.
- `account-links.ts` builds accounts with the new facts helper (its `balancesOf` call), no rule change.
- Ready to Assign moves by an on-plan adjustment; a closed account's history still counts (the engine joins
  non-deleted accounts, closed included), and the closing adjustment zeroes its contribution.

## Out of scope / left

- The dialog's **Bank Connection** section (linked-accounts screens) and **Loan Details** section (loans work)
  are not drawn.
- **Add Transaction on a closed account's page stays enabled**: `register/Register.tsx` takes no prop to
  disable adding, and the register files are held by another Build. The Worker does not refuse a new
  transaction on a closed account either: that check belongs in `services/transactions.ts`, also held. Left for
  the register Build: a `canAdd` prop on `Register`/`RegisterToolbar` (button and Shift+N) and a 422 in
  `addTransaction` for a closed account. File Import, Undo and Link Account are not built.
- Payment categories for credit accounts (EXF-532), transfers.

## Acceptance

Each case uses a fresh plan `ZZ-TEST <random>` made by the spec, and real-mouse clicks (`e2e/support/real-click.ts`:
centre, `elementFromPoint`, `page.mouse`), hovering a sidebar row before its pencil. "RTA" = `ready_to_assign` of
the current month's read. Cases marked *compare* reproduce in the source: the test plan, CLOSED group expanded,
a closed account's sidebar pencil (or its page's header pencil) → Edit Account, dark theme, default window; leave
with Cancel/X/Escape only.

1. **[486] Both pencils open the dialog.** Checking "ZZ-TEST Chk" at 250.00 with note "n1" (PATCH). From the
   account page, click the header pencil → dialog "Edit Account", nickname "ZZ-TEST Chk" focused, notes "n1",
   balance `250.00`, URL unchanged. Escape. Hover the sidebar row, click its pencil → same dialog. Repeat at
   1024×700.
2. **[486] Labels by kind.** Checking shows "Working Balance"; an Asset and a Liability show "Today's Balance";
   a Credit Card at 150.00 owed shows `-150.00`; all show the helper text.
3. **[486] Rename.** Nickname "D3 Checking Main", Save → dialog gone; the h1 and the sidebar row read "D3 Checking
   Main" without a reload; GET account name equals it.
4. **[486] Empty name.** Clear the nickname, Save → "The account name is required." under it, dialog open, no
   PATCH sent (request log), name unchanged. REST `PATCH {name:"  "}` → 422 `name_required`.
5. **[486] Duplicate name.** Second account "ZZ-TEST Sav"; rename the first to "zz-test sav", Save → "This account
   name already exists.", dialog open, name unchanged. REST → 409 `name_taken`. Renaming to "zz-test chk" (own
   name, other case) succeeds.
6. **[486] Notes.** Type "line one" Enter "line two", Save, reopen → textarea shows both lines; GET `note`
   equals it. Clear notes, Save → `note` null.
7. **[486] Checking adjustment.** Checking at 0.00; balance `312.50`, Save → register row "Manual Balance
   Adjustment", inflow $312.50, category "Inflow: Ready to Assign", cleared; header Working $312.50 and sidebar
   $312.50; RTA rose by 312500 (`expect.poll` on the month read).
8. **[486] Asset adjustment.** Asset at 1,000.00 → `11,000.00`: a +10,000.00 "Manual Balance Adjustment" whose
   category cell reads "Category not needed"; RTA unchanged.
9. **[486] Discard.** Change name, notes and balance, then Cancel; again with X; again with Escape → no request
   after open, nothing changed, no new transaction.
10. **[486] REST = MCP.** Worker test: the same rename, note and adjustment through REST and through
    `update_account`/`adjust_account_balance` give the same account, the same transaction fields and the same
    `change_log` rows (actions, entity types, before/after keys), actors `user:` vs `mcp:`. Unchanged balance →
    `adjustment: null` and no row. A Credit Card adjustment has `inflow_to_ready_to_assign` true; Liability and a
    from-bank loan false.
11. **[486, Lead] Empty balance.** Clear the balance, Save → "Enter an amount", dialog open, no request, no
    transaction. Same for `12.3.4`.
12. **[486, Lead] Picker.** After case 7, open Add Transaction's payee picker and type "Manual" → no "Manual
    Balance Adjustment" entry.
13. **[488] Delete.** New Checking at 0.00: the left button reads "Delete Account"; click it → no confirmation,
    URL `/{plan}/accounts`, the account is gone from the sidebar and All Accounts (no Starting Balance row),
    `GET` it → 404. Worker: an on-plan Checking at 250.00 deleted → RTA drops by 250000; the plan-wide list lacks
    its Starting Balance; `change_log` has `transaction delete` and `account delete`.
14. **[488] Close Account button.** After case 7 the left button reads "Close Account", `title` = the EXF-488
    close text; `can_delete` false.
15. **[488] Close at zero.** Checking with one adjustment, balance 0.00 → click Close Account → no second dialog;
    the account sits in CLOSED at $0.00 and no transaction was added.
16. **[488] Close on-plan with balance.** Checking at 33.33 (with one adjustment) → Close Account → dialog "Close
    Account" with "…An adjustment transaction will be created for -$33.33." and the info box → "Adjust Balance &
    Close" → CLOSED at $0.00; the register shows "Manual Balance Adjustment", memo "Closed Account", outflow
    $33.33, "Inflow: Ready to Assign"; RTA fell by 33330. Cancel instead → nothing changes.
17. **[488] Close tracking.** Asset at 22.22 (with one adjustment) → dialog without the info box; the adjustment's
    category is "Category not needed"; RTA unchanged.
18. **[488] Starred.** Star a Checking with an adjustment, close it → absent from STARRED, header without a star,
    `starred` false.
19. **[488] Closed dialog** (*compare*: layout, fields, footer, colours). The closed account's dialog shows only
    Nickname and Notes; footer "Re-open", disabled "Delete" with `title` = the EXF-488 delete text, "Cancel",
    "Save". Renaming it and saving works.
20. **[488] Re-open.** Click Re-open → dialog closes; the account is back in its type group at $0.00; no new
    transaction; star off; CLOSED gone when it held only this account.
21. **[488] Delete refused.** REST `DELETE` on an account with an adjustment → 409 `has_transactions`; account,
    transactions and `change_log` unchanged. MCP `delete_account` → tool error with the same message.
22. **[488, Lead] Linked.** Worker test with the Plaid stub: close a linked account → `linked` false and the
    connection read's `linked_account_id` null for that bank account, in the close batch (one account `update`
    row). Delete a deletable linked account → same.
23. **[488] Concurrency.** Worker test: five simultaneous `adjust-balance` to 100.00 from 0 → one adjustment of
    100000 and the balance is 100000; two simultaneous renames to one new name in two accounts → one wins, one 409.

## Manifest

touches: [apps/worker/src/services/accounts.ts, apps/worker/src/services/account-links.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/routes/accounts.ts, apps/worker/src/mcp/tools/accounts.ts, packages/schema/src/accounts.ts, apps/worker/test/mcp-coverage/accounts.ts, apps/worker/test/account-edit.test.ts, apps/worker/test/account-close.test.ts, apps/web/src/account/**, apps/web/src/api/accounts.ts, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/SidebarAccounts.tsx, apps/web/src/shell/tokens.css, e2e/edit-account.spec.ts, e2e/close-account.spec.ts, e2e/sidebar-groups.spec.ts, docs/account-edit-design.md, docs/account-edit-spec.md, docs/README.md]
shared: [apps/web/src/shell/Sidebar.tsx (mounts Edit Account from the row pencil), apps/web/src/shell/SidebarAccounts.tsx (onEdit wired, stale comment removed), apps/web/src/shell/tokens.css (two button colour tokens)]
migrations: 0
