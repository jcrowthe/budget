# Loan Add Activity design (EXF-542)

A loan's Account Activity gets an **Add Activity** menu with four items: **Add Payment** (the existing Record
Payment dialog, EXF-540), **Add Credit**, **Add Fee or Charge** and **Add Interest**. Credits and fees are real
balance changes on the loan; recorded interest is an **edited** interest line, written in exactly the shape the
Update Balance freeze path reads ([loan-update-balance-design.md](loan-update-balance-design.md), "How an edited line
becomes Reconciled"). Builds on [loan-engine-design.md](loan-engine-design.md) (the frozen-row hook) and EXF-547
(loans are off-plan, no category). The tasks are in the Build's spec.

## Source: observed vs assumed

**Observed.** Nothing was re-observed. The owner's signed-in session has no loan account (EXF-540, EXF-541 and
EXF-543 recorded this on 2026-11-25), and the menu and its dialogs live on a loan's page, which this Build may not
create. The menu subtitles, the dialog titles, copy and fields, and the worked example (estimated 1,000.00 +
recorded 50.00 → "Edited on November 15 / −$1,050.00", balance 199,800.00 → 199,850.00) come from the ticket, whose
author observed them.

**Assumed** (the ticket leaves these open):

- **D1 What Add Interest writes.** One stored interest row per save, payee the system payee `loan_interest`
  ("Loan Interest"), no category, not to Ready to Assign, `cleared = 'cleared'` (not reconciled, so the engine reads
  the line as **edited**). Its amount:
  - the month has stored interest rows (edited or reconciled): `−x`;
  - the month has an **estimated** interest line and no stored rows: `line.amount − x`. The engine replaces an
    estimate with the stored rows' sum (loan-engine-design, "Reconciled and edited lines"), so the estimate is
    written into the row; that is how "in addition to any existing estimated … interest" holds. `line.amount` is the
    interest **booked** this month (`min(estimate, P − escrow)`), not `estimated_total`;
  - the month has no interest line (no payment, no stored rows): `−x`.
  So the line reads `−(existing + x)` and the balance rises by exactly `x`. Why one row and not "estimate row +
  delta row": one write, one row, one undo; Update Balance sums the month's edited rows either way.
- **D2 Consequence of D1.** Once a month has a stored interest line, a payment recorded in it later books no
  estimated interest (EXF-540 rule: a stored line wins). The dialog's sentence speaks of the interest that exists
  when you save. Not new: an Update Balance has the same effect.
- **D3 Month and date of an interest row.** `month` defaults to the month of `today` (the browser's local date; REST
  default the UTC date), as Update Balance's C2. A month after today's month is refused (422 `future_month`): the
  dialog is for "known interest accrual". The row is dated `today` in today's month and the month's last day before
  it, as Update Balance dates a new frozen row.
- **D4 Fees and credits** are one row each on the loan: a fee `−x`, a credit `+x`; no payee, no category, not to Ready
  to Assign, `cleared = 'uncleared'` (Record Payment's A6), dated `date` (default today), with the memo. The engine
  counts them as **other** (a credit has no transfer, so it is not a payment, A4). A1 holds: they do not change their
  own month's estimate, only later months' (what is owed changed).
- **D5 Labels in Other Activity.** A row with no payee and no transfer is labelled **"Fee or Charge"** when negative
  and **"Credit"** when positive (it was "Transaction"): "−$25.00 Fee or Charge on November 15: Late fee".
- **D6 "Edited on <date>".** The interest line gains `edited_on`: the latest date of the month's interest rows that
  are not reconciled, null otherwise. The note reads "Edited on November 15"; "Edited" alone when `edited_on` is null.
  Escrow keeps "Edited" (no Add Escrow here).
- **D7 Amounts in the API are magnitudes** (`amount > 0`); the kind gives the sign, as Record Payment's amount is
  positive.
- **D8 Record Payment stays a button** beside the new primary **Add Activity** menu button, and the menu's Add Payment
  opens the same dialog. The ticket shows one button; keeping Record Payment leaves the existing specs, which open it
  by that name, unchanged.
- **D9 The Month select** lists the plan's months from the earliest the plan shows up to this month, newest first,
  labelled "Nov 2026" (`monthLabel`), defaulting to this month.
- **D10 Copy.** The ticket's text, with "Budget" where the source names itself. No help links.

## Why interest is a frozen row, not a delta

EXF-543's freeze path reads an edited line as "one or more `loan_interest` rows whose `cleared` is not `reconciled`"
(`repositories/loan-balance-update.ts` `editedRowsQuery`), sums them per month and replaces them with **one**
reconciled row (`services/loan-balance-update.ts` `addFrozen`). Writing Add Interest as such a row means Update
Balance needs no change: the row is read, summed and replaced, and its month reads Reconciled with the same amount.
A delta stored next to the estimate would need a new engine rule and a new freeze rule. The row is built by the
same function Update Balance uses (`frozenLoanRow`, shared, below), so the two cannot drift.

Worked example (the ticket's): a 200,000.00 mortgage at 6%, escrow 300.00, a 1,500.00 payment on November 15 →
interest estimated −1,000.00, balance −199,800.00. Add Interest 50.00 for November writes one row −1,050.00 dated
November 15 → interest −1,050.00 "Edited on November 15", balance −199,850.00. Update Balance with −199,850.00 then
soft-deletes that row and writes one reconciled row −1,050.00 (adjustment 0).

## The write: `POST …/accounts/{loan_id}/activity`

Body `{ kind: "interest" | "fee" | "credit", amount, month?, date?, memo?, today? }`:

- `interest` takes `month` (and `today`); `date` or `memo` with it is refused (422).
- `fee` / `credit` take `date` and `memo` (and `today`, the default date); `month` with them is refused (422).
- Answer 201 `{ kind, transaction, balance }`: the row as `get_transaction` returns it, and the loan's balance after
  the write (the account balance, estimated charges included).
- Refusals: unknown plan or account 404; not a loan 422 `not_a_loan_account`; closed 422 `account_closed`; a future
  interest month 422 `future_month`; a lost race 409 `balance_changed` (nothing written).
- The same shape is the MCP tool `add_loan_activity` (one flat schema shared by the route and the tool).

## D1 calls

Plan (1), account (1), one read batch (1: `balanceGroupsQuery` for the loan, the plan's loan system payees), one write
batch (1): **4 for every kind**, for 1 vs 24 months and 10 vs 100 payments. The write batch: the `loan_interest`
payee when missing (interest only, with its log row), the row insert guarded by `accountHolds(before,
accountSumIs(stored))`, and its `create` change_log row guarded by the row's existence. No new `IN` list.

The Activity read keeps its 3 calls: `edited_on` comes from one more statement in its existing batch.

## Balance, Ready to Assign, categories

The row is stored on the loan, so every balance reader (`balanceGroupsQuery`) sees it with no change. The loan is
off-plan, the row has no category and `inflow_to_ready_to_assign = 0`, so the budget engine never sees it: Ready to
Assign and every category are unchanged by all three kinds.

## Undo

The write runs in the request's change set (middleware), so `POST …/changes/{id}/undo` deletes the row. A
`loan_interest` payee created by the set stays (EXF-543's undo rule for system payees). No undo type map changes
unless a test proves one is needed.

## Shared row builder

`services/loan-frozen-rows.ts` (new) holds what both writes need: `frozenLoanRow` (the `TransactionRow` of a frozen
interest or escrow row: system payee, its name, no category, not to Ready to Assign, no memo, approved), and
`monthOf` / `lastDayOf` / `frozenRowDate`. `updateLoanBalance` uses it in place of its inline row (no behaviour
change); `addLoanActivity` uses it with `cleared: 'cleared'`.

## Web

- `loan/AddActivityMenu.tsx`: the primary **Add Activity** button (`aria-haspopup="menu"`) and a menu (the register's
  `Popover`) of four items, each a label and its subtitle.
- `loan/AddLoanActivityDialog.tsx`: one dialog for the three kinds (Record Interest, Record New Charge, Record Credit
  or Refund), the ticket's copy and fields; amounts through the plan formatter; Date in the plan's date format.
- After a save every query of the plan refetches (header, summary tiles, Account Activity), and the change set is
  recorded for the app's Undo, as Record Payment does.
- Colours only from `shell/tokens.css`.

## Departures

- **Record Payment stays a button** (D8) beside Add Activity.
- **Additions:** `today` in the request, `kind` and `balance` in the answer, `edited_on` on the interest line, the
  Fee or Charge / Credit labels (D5), and the `future_month` refusal (D3).

## Add Escrow (EXF-1013)

`{ kind: "escrow", amount, month?, today? }` records a known escrow amount for a month.

- **Total semantics.** `amount` is the month's **total** escrow, because the request is "record a known escrow
  amount": the escrow reads `-amount` afterwards. Let R (<= 0) be the sum of the month's reconciled `loan_escrow` rows.
  One batch soft-deletes every open (not reconciled) escrow row of the month and inserts one cleared row of
  `-amount - R` (system payee "Loan Escrow", built by `frozenLoanRow`, dated `frozenRowDate(month, today)`), with the
  replaced rows' `delete` log rows and the `create` in one change set (undo restores all of it).
  An amount at or below `|R|` is 422 `unprocessable_entity` ("Escrow this month can't be less than its reconciled x", x as for interest: money without a currency symbol).
  Re-entering the current amount still writes a row.
- **Contrast with Add Interest (D1).** Interest **adds** `amount` to what is there; escrow **sets** the total. Both are kept.
  Interest adds because the app's text says so; for escrow the estimate is a fixed term of the loan, so adding to it
  would not record "a known amount".
- **Mortgage only.** Another loan type is 422 `unprocessable_entity` "Escrow applies to a mortgage only". The order of
  refusals: loan, closed, mortgage, then a future month (422 `future_month`, "Escrow cannot be recorded for a month that has not begun").
  `date` and `memo` are 422, as for interest.
- **Mixed month.** The reconciled rows stay; only the open part changes (the interest rules, `loan-manage-design.md` M3).
- **The engine is unchanged.** It books escrow first, then `interest = min(estimate, payment - escrow)`, then principal.
  A recorded escrow above the payment's headroom moves estimated interest into `still_due`. Example: a 1,500.00
  payment, interest estimate 1,000.00, escrow 600.00: interest booked is 900.00, 100.00 still due, and the balance
  moves 200.00, not 300.00. Add Escrow never writes an interest row.
- **D6** now reads "Edited on <row date>" for escrow too (`escrowNote`), and the escrow line has an Edit button
  when it is edited (`transaction_id`, `editable`, `edited_on`).
- **Menu.** Five items for a mortgage (Add Escrow is fifth: "For recording a known escrow amount"), four for any other
  loan: `AddActivityMenu` takes `mortgage`.
- **D1 calls, measured.** Add Escrow is **4** (plan, account, one read batch, one write batch) for 10 vs 100 payments,
  1 vs 24 months and 1 vs 10 open rows (`loan-escrow-calls.test.ts`). The read batch always has the escrow-rows
  statement, so it keeps one shape.

## Not in this Build

Plan export/import of loan rows.

## Build notes

- Built as designed; no migration, no `packages/core` change, no undo type-map change (the undo test passed as is).
- `edited_on` comes from `editedOnQuery`, the fourth statement of the Activity read batch (still 3 D1 calls).
- `LoanAddActivityRequest` is strict (an unknown field is a 422) and refines per kind: `date` or `memo` with interest, `month` with a fee or credit, are 422.
- The loan page has no Undo button of its own; the app's Undo (plan stack) reaches the write from another page, which is what the e2e does.
- The e2e specs were written with the UI, after the worker tests (those were committed first and failed before: `/workspace/thread/evidence/fail-before/`).
