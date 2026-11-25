# Loan Update Balance design (EXF-543)

A loan's header gets **Update Balance** instead of Reconcile, and an "Updated …" line instead of the reconciled
label. The wizard confirms or corrects the balance at the lender, checks the rate and escrow, and writes one change:
it **freezes** the loan's interest and escrow lines as Reconciled (the hook of
[loan-engine-design.md](loan-engine-design.md), "Reconciled and edited lines"), adds a balance adjustment when a
difference remains, and stamps `last_reconciled_at` (the summary's `balance_updated_at`,
[loan-page-design.md](loan-page-design.md) B13). The tasks are in the Build's spec.

## Source: observed vs assumed

**Observed.** Nothing was re-observed. The owner's signed-in session has no loan account (EXF-540 and EXF-541
recorded this on 2026-11-25), and opening the wizard needs a loan, which this Build may not create. The flow, copy
and results come from the ticket, whose author observed them. The one number the ticket leaves implicit is
reconstructed from EXF-540 rule 8: the observed loan stood at −199,850.00 before the update because its November
interest had been **edited** to 1,050.00 (200,000 + 1,050 + 300 − 350 = 201,000 after deleting the payment).

**Assumed** (the ticket leaves these open):

- **C1 Which lines freeze.** Every interest and escrow line of every month up to and including the update's month
  becomes Reconciled, not only the current month's. Estimated lines are written at their amounts; edited lines keep
  their amounts. Why: an estimate left in an earlier month moves when the rate changes ("Keep this new interest rate
  going forward") or when an old payment is edited, and the balance the person just confirmed would drift. Months
  after the update's month (future-dated payments) stay estimated.
- **C2 The update's month** is the month of `today` (the browser's local date; REST default the UTC date), as
  reconcile does. With no payment in that month there is no line to freeze in it (EXF-540 rule 5).
- **C3 Rate and escrow in step 3** re-estimate only the update month's **estimated** lines. An edited line keeps its
  amount (that is how the observed loan kept 1,050.00 at 6%). With the box checked the loan's stored
  `interest_rate` / `escrow_amount` change too; unchecked, only this update's frozen line uses the value.
  Escrow is offered and accepted for a mortgage only (A5); `escrow_amount` on another type is refused (422).
- **C4 The comparison balance** is the account's balance (the header's Working Balance, which already includes the
  estimated charges), not the cleared balance: a loan has no register and Record Payment leaves its rows uncleared
  (A6). This is `adjustBalance`'s comparison, not reconcile's.
- **C5 The adjustment** uses the system payee `reconciliation_adjustment` ("Reconciliation Balance Adjustment"),
  memo "Entered automatically by Budget", `cleared: reconciled`, no category, not to Ready to Assign (the loan is
  off-plan: `adjustmentRow` already sets `inflow_to_ready_to_assign = on_budget`). It is dated `today`. Account
  Activity's Other Activity labels it **"Balance adjustment"** (the observed copy), as it labels a Starting Balance
  "Initial Balance".
- **C6 Other rows keep their cleared state.** Unlike reconcile, the update does not flip payments or other rows to
  reconciled: deleting a payment afterwards must work as EXF-540 rule 8 shows, and a reconciled row refuses a plain
  DELETE.
- **C7 Yes** writes the update with the current balance (no adjustment, rate and escrow unchanged) and closes the
  dialog; the Done screen follows the No path only. The help link "How do I find my account balance?" is left out,
  as reconcile left it out (the app has no help pages).
- **C8 Never updated** reads "Not Yet Updated" in the header.
- **C9 Copy.** The ticket's text with "Budget" where the source names itself: "Current balance in Budget", "The
  balance recorded in Budget doesn't match your account. …", "… between your account balance in Budget and at your
  lender …".

## How an edited line becomes Reconciled

An edited line is one or more frozen rows whose `cleared` is not `reconciled`. The update soft-deletes those rows and
creates **one reconciled row with their sum** in the same month. It does not flip their `cleared` flag, because the
undo engine refuses a transaction update to `reconciled` ("Reconciling can't be undone", `services/undo.ts`),
while a delete and a create both undo. Reconciled frozen rows already in the month stay as they are.

## The write: `POST …/accounts/{loan_id}/balance-update`

Body `{ balance, interest_rate?, escrow_amount?, keep_rate = true, keep_escrow = true, current_balance?, today?,
preview = false }`.

- `balance` is the signed account balance at the lender (milliunits; −199500000 for 199,500.00 owed), like
  `adjust-balance`'s. The web negates the typed magnitude.
- `current_balance` (addition): the balance the person saw. When sent and not the server's balance: 409
  `balance_changed` with the server's figure in `detail`, nothing written (reconcile's `cleared_balance` rule).
- `preview` (addition): computes the same answer and writes nothing. The wizard asks it after step 3 to learn whether
  a difference remains (step 4) without computing the engine in the browser.
- Answer `{ adjustment_amount, previous_balance, balance, balance_updated_at, account, adjustment }`.
  `adjustment_amount` is the ticket's field; the rest are additions. In a preview `adjustment` is null and
  `balance_updated_at` is the stored value.
- Refusals: unknown plan or account 404; not a loan 422 `not_a_loan_account`; closed 422 `account_closed`;
  `escrow_amount` on a non-mortgage 422 `unprocessable_entity`; a bad rate 400 (the `InterestRate` schema).

The arithmetic, in the service with `runLoan` (no new engine rule):

1. Run the engine on the stored rows and terms: `previous_balance` and each month's lines.
2. Build the frozen state: months before M at their run-1 amounts; month M with rate′ and escrow′ (C3), its edited
   lines at their sums. Run the engine again with those months frozen and the post-update terms: `B′`.
3. `adjustment_amount = balance − B′`. When it is not 0, the adjustment row is written in M (A1: an adjustment does
   not change its month's estimate, so the balance lands exactly on `balance`).

One `db.batch`, in this order, every statement guarded so that nothing is written unless the account is as read
(`accountHolds`) and its stored sum is the one read (`accountSumIs(working − estimated)`), as `adjustBalance` does:

- the missing system payees (`loan_interest` "Loan Interest", `loan_escrow` "Loan Escrow", and
  `reconciliation_adjustment` when an adjustment is written) through `systemPayee`;
- the frozen rows: one `insert … select … from json_each(?)` for all of them, and one `change_log` insert for their
  `create` rows from the same JSON (constant statements for any number of months, the account reorder's pattern);
- the edited rows' soft delete and their `delete` logs (same pattern);
- the adjustment row and its `create` log;
- the account update (`last_reconciled_at = now`, and `interest_rate` / `escrow_amount` when kept and changed) and
  its `update` log. Both `account` log images carry the same derived figures (balances), so only the changed
  columns differ.

The service checks the account update's `changes`; 0 means another write won: 409 `balance_changed`, re-read.

## Undo

The write runs in the request's change set, so `POST …/changes/{id}/undo` reverses it:

- created rows (frozen lines, adjustment) are deleted, deleted edited rows come back;
- the account gets `interest_rate`, `escrow_amount` and `last_reconciled_at` back: the undo type map for `account`
  (`repositories/undo.ts`) and its refusal allow-list (`services/undo.ts`) gain those three keys;
- a **system payee created** by the set is left in place instead of refusing the whole undo ("A system payee can't
  be undone" stays for any other change to a system payee). A system payee is plan furniture, never offered in the
  picker, and the next update reuses it.

Side effects, by design: a first-ever manual or reconcile adjustment (which creates its system payee) becomes
undoable on the server, and a reconcile that flipped no row too. The client's undo list (undo-design D5) is
unchanged: reconcile is still not recorded. The wizard records its change set like Record Payment does.

## D1 calls

Plan (1), account (1), one read batch (1: `loanMonthsQuery`, the stored sums, the edited frozen rows of months ≤ M,
the three system payees), the write batch (1, not in a preview). **3 for a preview, 4 for a write**, for 1 vs 24
months and 10 vs 100 payments, with or without an adjustment, first update or later. No new `IN` list.

## REST / MCP

- Route file `routes/loan-balance-update.ts`, service `services/loan-balance-update.ts`, schema
  `packages/schema/src/loan-balance-update.ts`, MCP `update_loan_balance` (same input, returns the same `data`).
  Coverage line in `test/mcp-coverage/accounts.ts`.
- `PAYEE_SYSTEMS` gains `loan_interest` and `loan_escrow`. **No migration:** `payees.system` is a plain `TEXT`
  column with no check (`20261116100100_payees.sql`), and the unique index per (plan, system) already covers the
  new values.

## Web

- `account/AccountHeader.tsx`, loan branch only (`isLoanType`): an **Update Balance** button where Reconcile sits
  (so `shift+E` is not bound on a loan), and "Updated <relative time>" (`reconciledAgo`, exact time in `title`)
  drawn from the loan summary's `balance_updated_at` (the same `useLoanSummary` query and month as `LoanPage`, so no
  extra request).
- `loan/UpdateBalanceDialog.tsx`: the steps Ask (Yes / No) → Enter balance → Difference + rate/escrow → Changes →
  Done. Colours only from `shell/tokens.css`; money through the plan formatter (U+2212 minus); the adjustment reads
  "+$350.00".
- After the write every query of the plan refetches (header balance, summary tiles and payoff, Account Activity).

## Departures

- **Request and response additions**: `current_balance`, `today`, `preview`; `previous_balance`, `balance`,
  `balance_updated_at`, `account`, `adjustment`.
- **Freezing goes back to the first month** (C1), beyond the ticket's "this month's estimates".
- **Undo** reaches beyond the type maps' columns: system payee creates are kept rather than refused.
- **No help link**, **"Not Yet Updated"** and the Yes path closing without a Done screen are assumptions (C7, C8).

## Not in this Build

EXF-542 (Add Activity, which will also write edited frozen rows), EXF-544 (simulator inputs), plan export/import of
frozen rows, and future-dated payments' estimates (C1).

## Build notes

Differences between this note and the Build, none of them changing a decision above.

- **Guard order.** The account update (`last_reconciled_at`, kept rate and escrow) is the batch's first guarded
  statement (account as read, stored sum, terms unchanged); every later statement is guarded by that marker
  (`last_reconciled_at = now`), because the first writes move the stored sum the guard compares. A lost race writes
  nothing and answers 409 `balance_changed`.
- **Adjustment.** `adjustment_amount = balance − B′` is solved by up to four passes of the engine: with
  future-dated payments an adjustment changes later months' estimates, so one pass can miss by a rounding step.
  Without them it lands in one.
- **Edited lines keep their date.** The replacement row takes the earliest edited row's date; a new frozen row is
  dated `today` in month M and the month's last day before it.
- **`account` in the answer** carries the derived balances; its `unapproved_count` and `needs_attention_count` are
  not read (they cost a call) and read 0. `GET …/accounts/{id}` has the real ones.
- **Other Activity** rows show their memo (`otherLine`), as payments do: "…Balance adjustment on November 15:
  Entered automatically by Budget".
- **Payee systems.** `loan_interest` / `loan_escrow` are also named in plan export's `SYSTEM_PAYEE_NAMES` (a typed
  map) and in the `list_payees` tool text; export and import of frozen rows stays out of this Build.
- **Request size.** The frozen rows travel as one JSON parameter (about 0.7 KB a row, two rows a month), so a
  30-year loan is about 0.5 MB, inside D1's limits.
