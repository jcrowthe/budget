# Loan paired category design (EXF-545)

A loan's paired category (EXF-482 `accounts.paired_category_id`) is an ordinary category in any group. When a
category is paired with an open loan, the Plan inspector gives it a loan header (the "Paired with … Account" link,
Available for Payment, Record Payment, Open Payoff Simulator, and the payments made this month). Its Target card
offers a **Debt Payment Target** computed from the loan. Builds on [loan-accounts-design.md](loan-accounts-design.md)
(pairing), [loan-engine-design.md](loan-engine-design.md) (EXF-540: balances with estimated charges, Record
Payment) and the card targets of EXF-538 ([targets-engine-design.md](targets-engine-design.md)). The tasks are in
the Build's spec.

## Source: observed vs assumed

**Observed.** Nothing new. EXF-540's look-only session (2026-11-25) found no loan account in the owner's plans,
and the only plan this app may open on the source has no open account. A paired category, its inspector and the
Debt Payment Target editor cannot be seen without creating a loan, which this Build may not do. The structure,
copy and figures below come from the ticket (its author observed them, with screenshots this Build does not
have). The Builder may look, read-only, at an **ordinary** category's inspector and target editor in the allowed
plan to match spacing. It records structure only, never names or amounts.

**Assumed** (the ticket leaves these open):

- **A1 Storage.** A Debt Payment Target is stored in the ordinary target columns as `cadence = monthly`,
  `behavior = set_aside`, `amount`, `day_of_month` (NULL = "Last Day of Month"). No migration, the same way card
  targets are stored. Its figures are those of a monthly set-aside target: needed = amount, funded = Assigned.
  That gives the ticket's "$1,500.00 needed by the 30th" in November, and "assigning 1,500.00 meets it".
- **A2 Type.** `Target.type` is `debt_payment` when the category is paired with an open loan and the stored
  target is monthly set-aside. Any other target on a paired category (one made before the pairing, or through
  `set_category_target`) keeps `type: null` and shows as an ordinary target. `set_category_target` is **not**
  refused on a paired category. The ticket restricts only the debt type.
- **A3 Which loan.** Only open, non-deleted loan accounts count. If two loans are paired with one category, the
  one created first (then lowest id) is `paired_account_id`, and `paid_this_month` counts that loan only.
- **A4 Paid this month** is the sum of the loan's payments dated in the month. A payment is defined as in the loan
  engine (A4 there): an inflow on the loan whose other side is a transfer from an on-plan account. "No payments
  recorded yet" shows when it is 0.
- **A5 Payoff arithmetic** follows EXF-541's rule, in integer milliunits. Amortize monthly with P&I = Monthly
  Payment − escrow (escrow for Mortgage only, as in the loan engine). Each month's interest is
  `estimatedInterest(balance, rate)` (to the cent). The last payment is what is left. `n` is the number of
  payments. Time Remaining is `n` as "30 years", "29 yrs, 11 mos" or "10 months". Payoff Date = the current month
  + `n`. Interest Remaining = Σ interest. Remaining to Pay = Principal + Interest. Principal is what the loan is
  owed now, `max(0, −balance)`, with the balance including EXF-540's estimated charges. For the AC2 loan this gives
  n = 360 (Nov 2056 from Nov 2026, "30 years") and interest 231,096.94. The ticket's 231,096.44 is within the
  AC's ±1.00. The source's figure matches a closed-form annuity with a fractional `n`, which would need floats.
- **A6 Payoff Date ↔ Monthly Payment.** Picking a Payoff Date `k` months away sets Monthly Payment to the smallest
  P&I (to the cent) that pays off in at most `k` payments, plus escrow. Typing a Monthly Payment sets the Payoff
  Date to the current month + `n`. The select lists every month from the next one up to the later of the
  minimum's payoff month and the typed payment's. A payment whose P&I does not cover the first month's interest
  never pays off: Time Remaining and Payoff Date show "—", and Save stays enabled (the target is only an amount).
- **A7 Summary rows.** "Paying the minimum every month: … Interest Remaining / … Time Remaining" always uses the
  loan's `minimum_payment`. The Summary block's "Minimum Payment" row is the loan's minimum. Time Remaining,
  Remaining to Pay, Principal and "Interest (r%)" follow the form's Monthly Payment. With the prefilled minimum
  both give the ticket's values.
- **A8 Grid wording.** A debt target never says "more" until something is assigned ("$1,500.00 needed by the
  30th"). Funded and fully spent (Available 0 after spending), the row says "Fully Spent", as the ticket shows.
  The pill is the ordinary target pill (yellow with a clock while underfunded).
- **A9 Header buttons.** Record Payment is disabled while the category's Available is ≤ 0. Open Payoff Simulator
  goes to the loan's page: the simulator itself is EXF-544, and the loan page belongs to EXF-541.

## REST / MCP

- `PUT /api/v1/budgets/{id}/categories/{category_id}/target` also accepts
  `{ type: "debt_payment", amount, day: "last" | 1..31 }` (`DebtPaymentTargetBody`). The route dispatches on `type`
  to `setDebtPaymentTarget`. A category that is not paired with an open loan (a payment category included) is a
  422 `debt_target_requires_loan_category`. A bad amount or day is a 422 `unprocessable_entity`.
- `Target.type` becomes `TargetType`: `card_payoff_by_date | card_monthly | debt_payment | null`. The change_log
  before/after keep the stored fields only (`targetToApi`), so undo and history are unchanged.
- `MonthCategoryDetail` gains `paired_account_id` (string or null) and `paid_this_month` (milliunits, 0 when
  unpaired). They are attached in the month service beside `note` and `upcoming`, not in the budget engine, so
  every month read (REST, MCP `get_plan_month`, the single-category read) carries them.
- MCP `set_debt_payment_target { budget_id, category_id, amount, day, today? }` calls the same service. The
  coverage line of the PUT lists it beside `set_category_target` and `set_card_payment_target`.
- Ready to Assign: the target writes no money. Assigning to the category lowers Ready to Assign as any assignment
  does. Record Payment's cash side is a categorized outflow in the paired category (Cash Spending), which comes
  out of the category's Available and leaves Ready to Assign unchanged.

## D1 calls

- The full month read (`loadInput(full)`) gains **one** set query, `pairedLoansQuery` in
  `repositories/loan-activity.ts`. It returns one row per open paired loan and month with payments, never per
  payment, and binds no list. `getPlanMonth`, `getPlanMonths`, `getMonthCategory` and `getCardPaymentStatus` go
  from 10 to 11. The plan export's read goes from 17 to 18. The pinned counts in `credit-call-count.test.ts`,
  `plan-export-calls.test.ts` and `upcoming-calls.test.ts` change by one, with the reason in a comment.
  `listPlanMonths` does not read it.
- `setDebtPaymentTarget`: the plan, the category, the pairing read, then `writeTarget`'s read and one batch (the
  target row and its change_log row). `setTarget` and `deleteTarget` each add the pairing read (to fill `type`).
  All are constant in the number of categories, loans and payments.

## Web

- `CategoryInspector` renders `LoanPairedCard` (new, `plan/panel/LoanPairedCard.tsx`) under the heading when
  `paired_account_id` is set. It shows "Paired with **<loan>** Account" (a link to `/<budget>/accounts/<loan>`), a
  card with "<Available> Available for Payment", Record Payment and Open Payoff Simulator, then "No payments
  recorded yet" or "<amount> paid this month". The Available Balance card stays as it is, so Cash Spending shows
  the payment.
- Record Payment opens `RecordLoanPaymentDialog` from `apps/web/src/loan/` **unchanged** (imported only). Its
  `loan` comes from the cached accounts list. `lastSourceId` comes from `useLoanActivity` for the current month,
  fetched only while the dialog is open (null until it answers).
- The Target card of a paired category is `DebtTargetCard` (new) when there is no target or the target is the
  debt kind. Otherwise it is the ordinary `TargetCard`. The empty state is "Create Debt Payment Target". The
  editor is `DebtTargetForm` (new). The saved view reuses the ordinary target's donut, message with Assign,
  breakdown, Edit Target and the snooze switch, with the heading "Monthly Debt Payment / <amount> Needed Each
  Month / By the End of the Month".
- The pure parts are in `packages/core/src/debt-targets.ts` (storage encoding, payoff arithmetic) and
  `packages/schema/src/debt-target.ts` (copy, duration text, draft ↔ body). The grid's wording comes from
  `target-wording.ts` (`targetStatusText` gains the debt branch, keyed on `paired_account_id`), so the grid files
  are not touched. Colours come only from `shell/tokens.css`.

## Departures

- **The month read model** (`services/months.ts`, `packages/schema/src/months.ts`) is outside the contract's May
  touch. The ticket names the month read as where `paired_account_id` and `paid_this_month` live, and the grid's
  "needed by the 30th" needs `paired_account_id` on the category without editing the grid. Three pinned D1 counts
  move by one (above).
- **Tool count.** `rename-rules.test.ts` and `payee-category-api.test.ts` pin the MCP tool count, and it goes up
  by one (one line each).
- **Record Payment intro.** The dialog always shows its loan-page intro. `RECORD_PAYMENT_INTRO_PAIRED` would need
  a new prop on a file closed to this Build (EXF-541 owns `apps/web/src/loan/**`), and no AC needs it. Follow-up.
- **"The loan page link opens this editor too"** is EXF-541's page and is left to it.
- **Payoff arithmetic** may duplicate EXF-541's loan projection, which runs in parallel and whose files are
  closed here. Follow-up: one shared function once both land.
