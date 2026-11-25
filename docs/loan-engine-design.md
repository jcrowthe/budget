# Loan engine design (EXF-540)

A payment to a loan books **escrow** (Mortgage) and **estimated interest** as charges on the loan, and the rest
goes to principal. A loan's page shows **Account Activity** per month instead of the register, and **Record
Payment** creates the transfer, with the cash side categorized to the loan's paired category. Builds on
[loan-accounts-design.md](loan-accounts-design.md) (EXF-482: `interest_rate`, `minimum_payment`, `escrow_amount`,
`paired_category_id`) and on EXF-547 (loans are off-plan and take no category). The tasks are in the Build's spec.

## Source: observed vs assumed

**Observed (2026-11-25, look-only).** The owner's signed-in session has three plans of their own and none has
a loan account. The test plan has no open account. Seeing Account Activity or the Record Payment dialog would
mean creating a loan or recording a payment, which this Build may not do. So nothing in this note was
re-observed. The rules, both worked examples and the dialog copy come from the ticket (its author observed them,
with screenshots this Build does not have). The source was only navigated: nothing was clicked, typed or saved.
Opening a plan updates its "Last used" line in the source's plan list.

**Assumed** (the ticket leaves these open):

- **A1 Interest base.** "Balance" in rule 4 means what was owed when the month opened: the previous month's
  closing balance plus a Starting Balance dated in the month (the mortgage example's loan starts in November).
  Other rows in the month (fees, credits, balance adjustments) do not change that month's estimate. This also
  means a balance adjustment in a month with a payment lands exactly on the entered balance.
- **A2 Escrow is capped by the payment.** Escrow booked is `min(monthly escrow, P)`, so a payment never makes
  the balance rise. Rule 6 says the same for interest.
- **A3 Rounding.** "To the cent" rounds half away from zero to 10 milliunits, in integer arithmetic (no floats).
- **A4 What counts as a payment.** A payment is an inflow (amount > 0) on the loan whose other side is a transfer
  from an on-plan account. Anything else on the loan is Other Activity.
- **A5 Escrow is for Mortgage only**, as rule 5 says. EXF-482 stores `escrow_amount` for any loan type (its D4),
  but the engine books it only for `mortgage`.
- **A6 The green check** on a payment line marks a payment the engine applied. It is not the cleared state.
  Record Payment creates both rows uncleared, as card payments do.
- **A7 Other Activity** appears only when the month has such rows. Its count badge is the number of rows.
- **A8 No rate** (a linked or imported loan, `interest_rate` NULL) estimates 0 interest.

## Representation: computed at read time

Interest and escrow are **not stored** while they are estimates. They are a pure function of the loan's terms
and its stored rows, grouped by month:

```
charges(month M) = engine(terms, payments in M, Starting Balance in M, closing(M-1), frozen lines of M)
```

The engine is `packages/core/src/loan-engine.ts`. It folds months in order from the loan's first row:

1. `owed = max(0, −(closing(M−1) + starting(M)))` (A1).
2. `estimate = round_cent(owed × rate ÷ 100 ÷ 12)` (rule 4, A3).
3. If `P = Σ payments(M) > 0`: `escrow = mortgage ? min(escrow_amount, P) : 0` (A2, A5),
   `interest = min(estimate, P − escrow)`, `principal = P − escrow − interest`, and
   `still_due = estimate − interest` (rule 5, rule 6).
4. With no payment and no frozen line: no interest line and no escrow line (rule 5).
5. `closing(M) = closing(M−1) + Σ rows(M) − estimated interest − estimated escrow`. Here rows(M) already holds
   any frozen line, so only the estimated parts are subtracted.

The mortgage example: owed 200,000.00, estimate 1,000.00, escrow 300.00, interest 1,000.00, principal 200.00,
closing −199,800.00. The auto loan: estimate 56.25, P 50.00, interest 50.00, still due 6.25, principal 0,
closing −15,000.00 (unchanged).

**Why not generated transactions.** Stored charge rows would have to be rewritten by every path that can add,
change, move or delete a payment: the register entry, edits, bulk actions, approve/reject, scheduled entries,
bank sync, file import, plan import and undo. Plan import and the undo engine are closed to this Build. A path
that misses the rewrite leaves a stale charge, and one payment edit changes the base of every later month. Reading
the charges from the rows that exist has no trigger to miss, so there is one source of truth: the transactions
and the loan's terms.

## When the lines are recomputed

On every read. There is no stored estimate to invalidate, so adding, editing, deleting, moving or undoing a
payment, changing the loan's rate or escrow (area 6), and a new month starting all show up on the next read.
A month with no payment has no estimated line. Frozen lines (below) do not move.

## Reconciled and edited lines: the hook for EXF-543

Rule 8: once a balance update reconciles a month, its interest and escrow lines show "Reconciled" and stay, even
if the payment is later deleted. That state is stored as **real transactions on the loan**, so no migration is
needed:

- One row per frozen line, dated in its month, amount negative, no category (the loan is off-plan).
- Its payee is a system payee: `payees.system = 'loan_interest'` or `'loan_escrow'`. The constants are
  `LOAN_INTEREST_SYSTEM` and `LOAN_ESCROW_SYSTEM` in `loan-engine.ts`. `PAYEE_SYSTEMS` gets them when EXF-543
  first creates such a payee. This Build creates none.
- `cleared = 'reconciled'` gives state `reconciled`. Any other cleared state gives `edited` (an EXF-542 or EXF-543
  correction that is not reconciled yet).

When a month has frozen interest rows, the engine uses their sum as the interest line and adds no estimate. The
same goes for escrow. The rows are already in every SQL balance sum, so they count once. Deleting the payment
leaves them in place, which gives the ticket's 201,000.00 case. EXF-543 only has to write those rows (with
change_log, in its own batch). The Activity read and every balance then follow. This Build's tests write such
rows directly to prove rule 8.

## How the balance is derived

`balance(loan) = Σ stored rows + Σ estimated charges (months without frozen lines)`.

The estimated part is computed in one place, the engine fed by one grouped query
(`repositories/loan-activity.ts` `loanMonthsQuery`: one row per loan, month and kind, where kind is payment,
starting, interest, escrow or other). The readers that report a balance add it:

- `repositories/transactions.ts` `balancesByAccount` and `openAccountsBalances`. These are the account list and
  get (sidebar, header), the account register's `balances`, the summary and All Accounts. Each runs its sum and
  `loanMonthsQuery` in **one `db.batch`**, so its D1 call count is unchanged. Each also returns the estimated
  part as `estimated`. The estimated part counts as **cleared** (the lender booked it).
- `repositories/reports.ts` `monthlySums` (Net Worth): the same batch, added per account and month.
- Write guards that compare a balance with a raw SQL sum use `balance − estimated`. These are
  `services/accounts.ts` `adjustBalance` and `closeAccount` (`accountSumIs`), and `services/reconcile.ts`
  (`clearedSumIs`). Without that, adjusting, closing or reconciling a loan with a payment would always conflict.

The Activity read uses the same engine run, so the month's `ending_balance` equals the account's balance when the
month is the latest. Per-row `running_balance` in the transactions API is left alone: a loan has no register.

**Ready to Assign.** Loans are off-plan (EXF-547). Estimated charges are never rows, and frozen rows are off-plan
with no category, so neither reaches the budget engine. A loan's Starting Balance is already "Category not
needed". The cash side of a payment is an ordinary categorized outflow in the paired category (Cash Spending
there), which comes from that category's Available, not from Ready to Assign.

## D1 calls

- `GET …/accounts/{loan_id}/activity`: the plan, the account, then one `db.batch` of `loanMonthsQuery`, the
  month's rows and the last payment source. Constant for 1 vs 12 months and for 10 vs 100 payments. The rows
  returned grow with months × kinds (at most 5 per month), never with the number of payments.
- `POST …/payments` for a loan: the plan, one accounts list, without `amount` one plan month read, then
  `createTransfer`'s fixed reads and its one batch (the pair plus two change_log rows).
- Balance readers: unchanged counts (the batch replaces the single select).
- No new `IN` list. The loan types are matched with `instr(?, ',' || type || ',')` and one bound parameter.

## Record Payment

- `POST /api/v1/budgets/{id}/accounts/{loan_id}/payments` `{ from_account_id, amount?, date?, memo? }`. That path
  already serves card payments (EXF-539, `routes/card-payments.ts`). The route now dispatches on the account's
  type: credit goes to `payCreditCard`, a loan to `recordLoanPayment`. Request and response shapes are shared
  (`{ amount, from_transaction, to_transaction }`).
- The source must be an open on-plan cash account (checking, savings, cash). The cash side is categorized to
  `paired_category_id` when that category is live, else left uncategorized ("This needs a category").
- Without `amount`, it takes the paired category's Available in the date's month. A refusal
  (`amount_required`) when there is no pairing or nothing is available.
- Undo: the write runs inside the request's change set (middleware), and its two change_log rows carry it like
  every other write.
- **From Account default** (the ticket's departure from the source): the activity read returns
  `last_payment_from_account_id`, the source of the loan's latest payment, if that account is still open,
  on-plan and cash. The dialog preselects it. With none, the field is empty and Save stays disabled until a
  choice is made.

## Activity read

`GET …/accounts/{loan_id}/activity?month=YYYY-MM-01` (default: the current UTC month) returns
`{ month, ending_balance, payments: [{ transaction_id, date, amount, memo, cleared, from_account_id,
from_account_name }], interest: null | { amount, state, estimated_total, still_due }, escrow: null | { amount,
state }, other: [{ transaction_id, date, amount, label, memo }], principal, last_payment_from_account_id }`.

- `state` is `estimated`, `edited` or `reconciled`. `amount`, `estimated_total` and `ending_balance` are signed
  balance changes (interest −1000000). `still_due` is a magnitude ≥ 0, and 0 on a frozen line.
- `principal`, `last_payment_from_account_id` and `other[].label` ("Initial Balance" for a Starting Balance row,
  else the payee name) are additions to the ticket's shape.
- MCP `get_loan_activity` and `record_loan_payment` call the same services.

## Web

- `pages/account.tsx` renders `loan/LoanActivity.tsx` instead of `Register` for the six loan types. Every other
  type keeps the register path unchanged. The header stays.
- Account Activity: a month switcher (‹ Month Year ›), the month's ending balance, a Record Payment button, and
  the sections Payments ("No payments this month" when empty), Interest Charges This Month, Escrow Held and
  Other Activity (count badge). Colours come only from `shell/tokens.css`.
- `loan/RecordLoanPaymentDialog.tsx` uses the ticket's copy (the loan-page wording "…will appear here…", and
  "Budget will estimate…" where the source names itself). The Date field uses the plan's date format.

## Departures

- **Shared payments route.** The ticket's POST path is already the card payment's, so `routes/card-payments.ts`
  dispatches. The coverage line becomes `tool: ["pay_credit_card", "record_loan_payment"]`.
- **Balance readers outside the new files** (listed above) change so that a loan has one balance everywhere.
- **"Payment: <loan>" payee on the cash side** (rule 1) is not shown. `paymentDisplay` and `RegisterTable` are
  card-specific, and `RegisterTable` belongs to a parallel unit. The cash row reads as a plain transfer.
- **Record Payment from the paired category's inspector** is left to EXF-545. Today the inspector has no hook
  for a loan's paired category.

## Not in this Build

EXF-541 (summary tiles, payoff, chart, paired-category panel), EXF-542 (Add Activity: credit, fee, interest),
EXF-543 (the Update Balance wizard, which writes the frozen rows above), EXF-545 (Debt Payment Target and the
paired-category inspector), and plan export/import of loan terms and frozen rows.
