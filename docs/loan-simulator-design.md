# Loan Payoff Simulator (EXF-544)

The simulator is a calculator. It writes nothing until "Copy and go to my plan" is used. It fills the
"Loan Payoff Simulator" dialog shell that EXF-541 shipped (`apps/web/src/loan/PayoffSimulatorDialog.tsx`). It adds a
Monthly Payment input, a "One time extra in <month>" input, a Simulation series on the chart, the savings, Reset
all changes, and Copy to plan.

## Decisions

- **S1 Client-side, no new endpoint.** The simulation runs in the browser with `projectLoan`
  (`packages/core/src/loan-projection.ts`). Its inputs are the loan summary's figures (`remaining_balance`,
  `interest_rate`, `escrow_amount`, `payment_used`) plus the account's `type` and the month the page reads. Those
  are the same inputs `getLoanSummary` (`apps/worker/src/services/loan-summary.ts`) passes to `projectLoan`. The
  server terms come from the account row (`repositories/loan-activity.ts` `loanMonthsFromRows`), and the summary
  returns them unchanged, except `escrow_amount ?? 0`, which `projectLoan` also applies. So, with no change, the
  simulation equals the summary's projection and the savings are exactly zero. Nothing the ticket's ACs check
  needs a server read. The ticket's `POST .../payoff-simulation` and MCP `simulate_loan_payoff` are not built
  (a departure; see Follow-ups).
- **S2 One-time extra timing.** The extra is applied to the balance at the start of the first projected month,
  before that month's interest. The monthly payment then amortizes as usual. `schedule[0]` stays the balance
  before the extra, so the Simulation and Current Track lines start at the same point. With 199,500.00 at 6%,
  escrow 300.00, 1,500.00/month and 10,000.00 once in November, the result is 313 payments and Dec 2052 (the
  ticket's figures exactly). Interest is 185,515.16 against the ticket's observed 185,276.06, a gap of 239.10.
  Folding the extra into the month's payment instead gives a gap of 476.05. The ticket says the source's timing is
  unknown and accepts a gap of about 240.00. An extra at least as large as the balance pays the loan off in the
  first month: 1 payment, payoff the next month (payoff = from + payments, as `projectLoan`), no interest.
- **S3 Core API, additive.** `ProjectionIn` gains an optional `extra_once` (milliunits, default 0). With 0,
  `projectLoan` behaves byte for byte as before. `simulatePayoff(terms, base, change)` returns the simulation's
  projection, `principal` (the balance), `remaining_to_pay` (principal + interest), `interest_savings` and
  `months_saved` against the base projection (both null when either side never pays off).
- **S4 Baseline.** The as-is figures come from the summary (`payment_used`, `payments_remaining`, `payoff_month`,
  `interest_remaining`). "Changed" means the typed monthly payment differs from `payment_used`, or the extra is
  greater than 0.
- **S5 Payoff Date is computed, not editable.** The ticket observed a select. Here it is the simulation's payoff
  month as text. That keeps the EXF-541 shell spec (`e2e/loan-page.spec.ts` AC5: `getByText("Nov 2056")`) passing,
  and no AC needs a target-date back-solve (a departure; see Follow-ups).
- **S6 Copy to plan.** This reuses `useSaveTarget` (`apps/web/src/api/targets.ts`), which does
  `PUT .../categories/{id}/target` with `{ type: "debt_payment", amount, day }`. The write is recorded through
  `recordPlan`, so the plan's Undo picks it up as a history entry. `day` keeps the paired category's current debt
  target day (`day_of_month ?? "last"`), or `"last"` when it has no debt target. The button shows only when
  something changed, the loan has a paired category, and the payment is greater than 0. After the write succeeds,
  it navigates to `planPath(budgetId, month)`. There is no new write path.
- **S7 Unpaired loans.** Without a paired category there is nothing to copy to, so the button is hidden. The
  simulator still works.
- **S8 Principal.** "Principal" is the remaining balance. The ticket's extra-case row implies 199,550.00, a source
  artefact. Remaining to Pay is principal + simulated interest.
- **S9 Entry from the inspector.** The paired inspector's "Open Payoff Simulator" (`plan/panel/LoanPairedCard.tsx`)
  still goes to the loan page, where the simulator is one click away. Opening the dialog directly from there means
  changing a file outside this Build's scope (a follow-up).

## Copy

- Left column: "<min> Required Minimum Payment". "Monthly Payment", with the hint "<payment_used> is your current
  monthly target." (source target) or "<min> is your required minimum payment." (source minimum). "Payoff Date",
  with the hint "You have N payments remaining on your loan." (unchanged) or "Your original payoff date is
  <Mon YYYY>" (changed). "One time extra in <Month name>", with the hint "Extra one-off payments can have a large
  impact on your loan."
- Summary box: when unchanged, "Paying the minimum every month:" (source minimum) or "Paying your target every
  month:" (source target), with Interest Remaining and Time Remaining. When changed, one line per change:
  "Paying +$X extra every month" (or "Paying $X less every month") and "Paying +$X extra this month", with
  Interest Savings and Time Savings (`durationText`). Then Remaining to Pay, Principal and Interest, and
  "Escrow amounts are not included".
- When the payment never pays the loan off, the Payoff Date is "—", with "This payment won't pay off this loan",
  and the savings are "—".
- Legend: Past Balance, Current Track, Simulation ("Estimated future balance if you pay the updated amounts on the
  left side of the simulator."). The Simulation colour comes from `shell/tokens.css`.

## Follow-ups

- REST `POST /budgets/{id}/accounts/{loan_id}/payoff-simulation` with MCP `simulate_loan_payoff`, so an agent can
  simulate. It would call the same `simulatePayoff`.
- Payoff Date as a select that back-solves the monthly payment for a chosen month.
- Open the dialog directly from the paired inspector.
