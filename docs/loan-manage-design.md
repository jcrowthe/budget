# Loan manage design: correct a recorded line, unpair, pair with a new category

Two follow-ups filed during the loan chain. (1) A recorded interest, fee or credit line on a loan's Account Activity
can be edited or deleted from the page. Until now only Undo or the transactions API could correct one. (2) From the
loan page a loan can be unpaired, or paired with a **new** category. Get Started offered only existing categories
(EXF-541, [loan-page-design.md](loan-page-design.md) "Pairing from the loan page"), and nothing cleared a pairing.

Builds on [loan-add-activity-design.md](loan-add-activity-design.md) (EXF-542: edited interest rows, fee and credit
rows, `services/loan-frozen-rows.ts`), [loan-update-balance-design.md](loan-update-balance-design.md) (EXF-543:
reconciled frozen rows), [loan-page-design.md](loan-page-design.md) (EXF-541: `PUT …/paired-category`,
`pair_loan_category`) and [loan-accounts-design.md](loan-accounts-design.md) (EXF-482: the create-with-new-category
batch in `services/accounts.ts`). No migration. The tasks are in the Build's spec.

## Which lines can be changed

| Line on Account Activity | State | Edit | Delete | Shown as |
|---|---|---|---|---|
| Interest | estimated | no | no | as today. Add Interest is how an estimate is changed |
| Interest | edited (has stored rows that are not reconciled) | yes | yes | an **Edit** button on the row |
| Interest | reconciled (every stored row reconciled by Update Balance) | **refused 409** | **refused 409** | a lock icon, "Reconciled, not editable" |
| Escrow | estimated | no | no | as today. Add Escrow is how an estimate is changed |
| Escrow | edited (has stored rows that are not reconciled) | yes | yes | an **Edit** button on the row (EXF-1013) |
| Escrow | reconciled | **refused 409** | **refused 409** | a lock icon, "Reconciled, not editable" |
| Other: Fee or Charge / Credit (no payee, no transfer) | not reconciled | yes | yes | an **Edit** button on the row |
| Other: Balance adjustment (Update Balance, reconciled) | reconciled | **refused 409** | **refused 409** | the lock icon |
| Other: Initial Balance, a payee's row; Payments | | refused 422 | refused 422 | as today (no button, no lock) |

- **M1 Reconciled is a 409** `reconciled_line` ("This line was reconciled by Update Balance and can't be changed"):
  the request is well-formed, the row's state forbids it, as the other state conflicts in the app. A row that is
  not a fee, credit or interest row is 422 `not_editable_activity`. An id that is not a live row of this loan is 404.
- **M2 How the UI shows "not editable".** A reconciled interest line, a reconciled escrow line and a reconciled
  Other row carry a small lock icon after the amount, with the accessible name and tooltip "Reconciled, not
  editable", and no Edit button. The note text still reads "Reconciled". The flag comes from the server
  (`editable`, below), so the page never decides it itself.
- **M3 A mixed month.** A month whose interest has reconciled rows and later an Add Interest row reads **edited**
  (the engine's rule: not every row reconciled). Editing it changes only its not-reconciled part: the reconciled
  rows stay. The edit's `amount` is the **line's total** magnitude, as the row shows it. The new edited row is
  `−amount − R`, where `R` (≤ 0) is the month's reconciled sum. An amount that would make that row 0 or positive
  (`amount ≤ |R|`) is 422 `unprocessable_entity` ("Interest this month can't be less than its reconciled
  $X"). Deleting a mixed line removes its not-reconciled rows: the line reads Reconciled again.

## The writes: `PATCH` and `DELETE …/accounts/{loan_id}/activity/{transaction_id}`

The existing activity resource (`POST …/accounts/{loan_id}/activity`, EXF-542) gains the row-level verbs. The id is
the `transaction_id` that Account Activity already gives every payment and Other row, and now the interest line too.

- **PATCH body** `{ amount?, date?, memo?, today? }`, strict (an unknown field is 422), at least one of `amount`,
  `date`, `memo`. `amount` is a magnitude > 0 (EXF-542's D7): the row keeps its kind, so a fee stays a fee and a
  credit a credit.
  - Interest takes `amount` (and `today`). `date` or `memo` with it is 422, as in Add.
  - A fee or credit takes `amount`, `date` (the row may move to another month), `memo` (`null` clears it).
- **DELETE** has no body.
- **Answer** 200 `{ kind: "interest" | "fee" | "credit", transaction, balance }`, the shape of Add's answer:
  `transaction` is the row written (as `get_transaction` returns it), `null` after a delete. `balance` is the loan's
  balance after the write, computed as Add does.
- **Refusals**: unknown plan, account or row 404; not a loan 422 `not_a_loan_account`; closed 422
  `account_closed`; reconciled 409 `reconciled_line` (M1); not editable 422 `not_editable_activity`; a lost race 409
  `balance_changed` (nothing written).
- **MCP**: `update_loan_activity` (the PATCH input plus `budget_id`, `loan_account_id`, `transaction_id`) and
  `delete_loan_activity`, each returning the route's `data`. Two tools, because every REST operation has its tool
  (docs/conventions.md step 7). The pinned tool count goes up by two.

Why the row verbs and not a month-keyed interest endpoint: one resource, one id the page already holds, and the same
id works for fees, credits and interest. An interest id names its month's line: the service acts on the whole line.

### Editing an edited interest line keeps the frozen-row shape

The line can be several rows (each Add Interest adds one). An edit **replaces** the month's not-reconciled interest
rows with **one** new row built by `frozenLoanRow` (`services/loan-frozen-rows.ts`, `cleared: "cleared"`). It is
dated `frozenRowDate(month, today)`, as Add Interest dates a row, so "Edited on" reads the day of the edit. The old
rows are soft-deleted. Replace, not update in place: one path for one row or many, and Update Balance's freeze reads
the result unchanged. The row ids change, and the page refetches.

A delete soft-deletes the month's not-reconciled interest rows. The line goes back to estimated (no stored rows
left), to Reconciled (a mixed month), or disappears (no payment in the month).

### Fees and credits

An edit updates the row in place (`amount` with its sign, `date`, `memo`, `updated_at`). The change_log row is an
`update` with before and after images. A delete soft-deletes the row and logs a `delete`.

### One batch, guarded

Each write is one `db.batch` with its change_log rows, run in the request's change set. Every statement is guarded so
that nothing is written unless the loan is as read and its stored sum is the one read
(`accountHolds(before, accountSumIs(loanId, stored))`, Add's guard). Logs go before the rows they describe. When a
write moves the sum, the later statements are guarded instead by a marker the first write leaves: the interest edit
inserts its new row first, and the rest is guarded by that row's existence. The replaced rows' delete logs and their
soft delete reuse EXF-543's JSON statements (`editedLogStmt`, `editedDeleteStmt` in
`repositories/loan-balance-update.ts`), so one row or ten is the same number of statements. When the guarded first
statement changes nothing, the answer is 409 `balance_changed`.

## D1 calls

- PATCH and DELETE: plan (1), account (1), one read batch (1: the addressed row with its payee's system, the
  month's interest rows found through that row, `balanceGroupsQuery` for the loan, the loan system payees), the write
  batch (1). **4 for every kind**, for 1 vs 24 months, 10 vs 100 payments, and 1 vs 10 interest rows in the month. A
  refusal stops after the read batch (3).
- The Activity read stays at **3**: `editedOnQuery` becomes one statement that also returns the latest
  not-reconciled interest row's id (it stays the fourth statement of the existing batch).
- No new `IN` list.

## Activity read additions (`packages/schema/src/loan-activity.ts`)

- `LoanInterestLine.transaction_id`: the latest not-reconciled interest row's id when the line is edited, else
  null. `LoanInterestLine.editable`: `state === "edited"`.
- `LoanEscrowLine.edited_on`, `transaction_id` and `editable` (EXF-1013): the same meaning as on the interest line, for the
  latest not-reconciled `loan_escrow` row (`editedOnQuery` with the escrow system, the fifth statement of the same batch).
- `LoanOtherRow.editable`: a row with no payee, no transfer, not a split, and not reconciled. `LoanOtherRow.reconciled`
  (boolean) drives the lock icon. Payments keep their existing `cleared`.

## Pairing: unpair, or pair with a new category

`PUT …/accounts/{loan_id}/paired-category` and `pair_loan_category` take **exactly one** of:

- `{ category_id: "<id>" }`: as today (EXF-541);
- `{ category_id: null }`: **unpair**, `paired_category_id` becomes null;
- `{ new_category: { name, group_id } }` or `{ new_category: { name, new_group_name } }`: create the category (and
  its group when `new_group_name`) and pair with it. The body is EXF-482's `LoanNewCategory`
  (`packages/schema/src/accounts.ts`), reused, not copied.

Both or neither is 422. The answer stays `{ account }` (`paired_category_id` carries the new id). We extended the
endpoint rather than adding `DELETE …/paired-category` or a new tool: one operation, one tool, and no coverage or
tool-count change for pairing.

- **P1 Unpair** is one guarded account update and its `account` change_log row (before/after
  `paired_category_id`), the existing pairing statements with a null target. Undo already allows
  `paired_category_id` (`services/undo.ts`). The category stays, with its money and target. A loan that is already
  unpaired answers its account and writes nothing (no change set). A closed loan is refused (422 `account_closed`),
  as pairing is. Its pairing is left to category delete (EXF-990) and to reopen.
- **P2 New category** reuses EXF-482's statements in `services/accounts.ts`: the group and category inserts with
  their change_log rows (`pairingStmts`) and the name and group checks (`resolveLoan`'s new-category block). Both
  become exported functions with no change in behaviour, and the create flow calls the same functions. Their
  guard is the loan's pairing guard without the category part (loan active, open, still paired as read). The account
  update that follows is guarded by the full pairing guard on the new id, which holds only once the category
  exists. Batch order: group log, group, category log, category, account log, account update. The name and group
  refusals are EXF-482's (422 `unprocessable_entity` with `CATEGORY_NAME_TAKEN`, `GROUP_NAME_TAKEN`, the unusable
  group text).
- **Undo** of a pair-with-new removes the account change, the category and the new group (reverse order), so the
  loan is back to its previous pairing.
- **D1 calls**: plan, account, the new-category checks (a constant number: the group and a name check), the sort
  read(s) of `pairingStmts`, the facts reads, one batch. Constant for 10 vs 100 categories and groups and for 10 vs
  100 payments. Unpair: plan, account, facts, one batch.

## Web

- **Account Activity** (`loan/LoanActivity.tsx`): an editable interest line and every editable Other row get an
  **Edit** button (pencil icon, accessible name "Edit interest" / "Edit <label> on <Month D>"). It opens
  `loan/EditLoanActivityDialog.tsx`: "Edit Interest" (Amount, the line's magnitude; the month is shown, not
  editable) or "Edit Fee or Charge" / "Edit Credit" (Amount, Date, Memo). Footer: Delete on the left, Cancel and
  Save. Delete asks once more in the dialog ("Delete this line?" Delete / Cancel) before it writes. Reconciled lines
  show the lock (M2). After a save or delete every query of the plan refetches and the change set is recorded for the
  app's Undo, as Add Activity does.
- **Pairing dialog** (`loan/PairLoanDialog.tsx`): offers "Select an existing category" and "Create a new category"
  (name, group or New Category Group, the group's name). It reuses the create flow's `PairCategoryStep`,
  `pairReady` and `pairRequest` (exported by `shell/add-account-loan-steps.tsx`, imported, not edited). Styles for
  the choices live in `loan/loan-page.css` (the shell's are scoped to the account modal). The existing select keeps
  its label "Select a category", so the EXF-541 spec still finds it.
- **Paired panel** (`loan/PairedCategoryPanel.tsx`): an **Unpair** button beside the heading. It opens a confirm
  dialog "Unpair this loan?": "The category stays in your plan with its money and target." Unpair / Cancel. After
  unpairing the panel shows Get Started.
- Colours only from `shell/tokens.css`. Copy lives in `packages/schema/src/loan-*.ts`.

## Departures

- **Escrow** was not editable in the first Build (no Add Escrow). EXF-1013 adds Add Escrow, and an edited escrow line is edited or deleted like an interest line. M3 applies to it: a month's open rows become one row, a mixed month changes only its open part, and an amount at or below the reconciled part is 422 ("Escrow this month can't be less than its reconciled 300.00"). The manage verbs do not check the loan type, so an escrow line on a non-mortgage (only possible through the transactions API) can still be corrected or removed.
- **Payments** are not edited from Account Activity: they are transfers with a cash side, outside this follow-up.
- **A fee can't become a credit** (or the reverse) by an edit: delete it and add the other.
- **Re-pairing a paired loan** from the page (a "Change" action) is not added. Unpair, then Get Started. The API
  already re-pairs.
- **Additions**: `transaction_id` and `editable` on the interest line, `edited_on`, `transaction_id` and `editable` on the escrow line (EXF-1013), `editable` and
  `reconciled` on Other rows; `today` on PATCH.
- **Tool count** +2 (`update_loan_activity`, `delete_loan_activity`).

## Not in this Build

Editing payments from the loan page, plan export/import of loan rows and pairings.

## Build notes

- **D1 calls, measured.** PATCH and DELETE of an activity row: **4** for an interest line, a fee and a credit, for 1 vs
  24 months, 10 vs 100 payments and 1 vs 10 interest rows in the month; a refusal (reconciled line) **3**. Account
  Activity GET stays **3** (`editedOnQuery` is one statement with a window `max(date) over ()` and `limit 1`).
  Pairing: unpair **6**, pair with a new category in a new group **8**, in an existing group **9**; the same for 10 vs
  100 categories/groups and 10 vs 100 payments (`loan-manage-pairing-calls.test.ts`).
- **Departures from the spec's order of work.**
  - The read batch is three statements (the addressed row, the month's interest rows, `balanceGroupsQuery`); the loan
    system payees query is not needed: an interest edit reuses the replaced rows' own payee id, so the call count is the
    same (4).
  - Reconciled refusals: a reconciled interest line, escrow row, Balance adjustment row and a payee-less (fee/credit)
    row are 409 `reconciled_line`; every other row that is not a fee, credit or interest line is 422
    `not_editable_activity`, including a reconciled payment.
  - Moving a fee to an earlier month also moves the interest that carries into later months, so the answer's `balance`
    is the engine's balance after the write (equal to the account's), not the old balance minus the change.
- **EXF-1013 (escrow).** `monthInterestRowsQuery` became `monthFrozenRowsQuery`: the month's rows of the addressed row's own system (interest or escrow), one statement, no IN list. `classify` returns one `line` type over the system; update and delete share one branch. PATCH and DELETE of an escrow line are **4** D1 calls (1 vs 10 open rows, 10 vs 100 payments, 1 vs 24 months), a refusal **3**, Account Activity **3**. No new tool: the count stays **121** (`update_loan_activity` and `delete_loan_activity` take an escrow `transaction_id`).
- **Undo type maps** were not changed: every undo test passes on the existing maps (`account` update of
  `paired_category_id`, `transaction` create/update/delete, `category` and `category_group` create).
- **Surface.** Tool count 118 -> 120 (`update_loan_activity`, `delete_loan_activity`); `pair_loan_category` gained
  `category_id: null` and `new_category` and no new tool. `services/accounts.ts` exports `checkNewCategory`,
  `pairingStmts` and `explainNewCategoryRefusal` with no behaviour change (the loan-accounts specs pass unchanged).

## Change category

A paired loan's Paired Plan Category panel has a **Change category** button beside Unpair. It opens the same
pairing dialog as Get Started (`PairLoanDialog`, which reuses `PairCategoryStep`) with the current category
preselected, and re-pairs through the one `PUT …/paired-category` call. That is a single change set, so the
Plan's Undo restores the previous pairing.
