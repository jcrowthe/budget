# Loan page design (EXF-541)

A loan's page gets summary tiles, the payoff date, a "Your Loan's Progress" chart card, the promo banner and the
Paired Plan Category panel, all above the Account Activity that EXF-540 shipped
([loan-engine-design.md](loan-engine-design.md)). The payoff and the chart are projected with the same engine
(`runLoan`) from the loan's current balance and terms. The tasks are in the Build's spec.

## Source: observed vs assumed

**Observed.** Nothing was re-observed. The owner's signed-in session has no loan account (EXF-540 recorded the
same on 2026-11-25), and seeing the loan page would mean creating one, which this Build may not do. The layout,
copy, payoff arithmetic and the five worked cases come from the ticket, whose author observed them. The payoff
simulator's numbers in EXF-544 (199,500.00 → 357 payments, Aug 2056; 2,000/month → 178 payments) were used as a
cross-check of the same arithmetic.

**Assumed** (the ticket leaves these open):

- **B1 Current month.** "Months counted from the current month" is the month the page asks for: the web sends the
  user's local current month (`?month=`), and the REST default is the current UTC month, as Account Activity does.
- **B2 Payoff Date = current month + n**, exactly as the ticket's arithmetic says, also when a payment was already
  made this month (the 199,800.00 case: n = 359 → Oct 2056).
- **B3 Payment used.** The paired category's target amount when the paired category has a target with a monthly
  cadence that repeats every month (EXF-545's Debt Payment Target will be one); otherwise the loan's
  `minimum_payment`. Weekly, yearly and custom targets are not converted: they fall back to the minimum.
- **B4 Never pays off.** When the payment after escrow does not exceed the first month's interest, the loan is
  never paid off: `payoff_month` and `payments_remaining` are null, the tile shows "—" and the sentence reads
  "The minimum payment of $X won't pay off this loan" (with a target: "Your monthly target of $X won't pay off
  this loan"). The projection also stops at 1,200 months (100 years) and reports null.
- **B5 Paid off.** A remaining balance of 0 gives `payments_remaining` 0, `payoff_month` = the current month, and
  the sentence "This loan is paid off".
- **B6 Original balance** is the magnitude of the loan's Starting Balance rows. A linked or imported loan has none:
  `original_balance` and `percent_remaining` are null, the "(x%)" part is left out and the chart has no Original
  Payment Schedule line.
- **B7 Percent** is remaining ÷ original × 100, rounded half up to one decimal in integer arithmetic, shown with
  one decimal ("100.0%").
- **B8 Duration text.** n a multiple of 12: "N years" ("1 year"); n < 12: "N months" ("1 month"); otherwise
  "Y yrs, M mos" with "yr" and "mo" when the number is 1.
- **B9 Missing terms.** A null rate counts as 0 (A8) and its tile shows "—". A null minimum payment (linked loan)
  gives no projection: Payoff Date "—", no Current Track and no banner sentence.
- **B10 Escrow tile** shows for `mortgage` only, also when the escrow is 0 (AC1, A5).
- **B11 Chart axis.** When the plotted months span more than 24 months, the x axis shows years ("2026 … 2056"),
  otherwise every other month ("Nov '26", "Jan '27"). The y axis uses the reports' `niceTicks` and `tickMoney`.
- **B12 Banner dismissal** lasts for the page session (in memory, per plan). Persisting it would add a key to
  `packages/schema/src/ui-state.ts`, which this Build may not touch.
- **B13 `balance_updated_at`** is the account's `last_reconciled_at` (null = "never"). The header's "Updated …"
  line is the header's (and EXF-543's Update Balance) and is not drawn by this Build.

## The projection (packages/core/src/loan-projection.ts)

`projectLoan(terms, { balance, payment, from })` amortizes month by month by calling `runLoan` on one synthetic
month at a time: `starting = −balance`, `payments = p`, no other rows. So interest (`estimatedInterest`, A3
rounding), escrow (`min(escrow_amount, p)`, mortgage only) and principal are exactly what Account Activity books
for the same month. The last payment is capped at `balance + interest + escrow` so the balance lands on 0. It
returns `{ payments_remaining, payoff_month, interest_total, schedule: [{ month, balance }] }`, where `schedule[0]`
is `{ from, balance }` and the last point is `{ payoff_month, 0 }`.

Checked against the ticket: 200,000 @6%, escrow 300, payment 1,500 → 360 (Nov 2056); 199,800 → 359 (Oct 2056);
199,500 → 357 (Aug 2056); auto 15,000 @4.5%, 350 → 47 (Oct 2030); medical 1,000 @0%, 100 → 10 (Sep 2027). The
total interest of the first case is 231,096.94 (the source's simulator shows 231,096.44, within the ±1.00 that
EXF-544 allows).

## The server read: a new constant-D1 endpoint

`GET /api/v1/budgets/{id}/accounts/{loan_id}/summary?month=YYYY-MM-01` (the ticket's path), MCP `get_loan_summary`,
service `services/loan-summary.ts`. A new endpoint rather than an extension of the activity GET: the summary does
not depend on the month being viewed in Account Activity, and the ticket names this path and tool.

```
{ remaining_balance, original_balance, percent_remaining, interest_rate, minimum_payment, escrow_amount,
  payment_used, payment_source, payoff_month, payments_remaining, interest_remaining, schedule:[{month, balance}],
  history:[{month, balance}], original_schedule:[{month, balance}],
  paired_category: { id, name, group_name, available, target } | null, balance_updated_at }
```

- `remaining_balance` = max(0, −closing of the last engine month), which equals the account's balance everywhere
  else (EXF-540's single balance).
- `payment_used` / `payment_source` (`"target"` or `"minimum"`, B3), `interest_remaining`, `history` (the engine's
  monthly closings as magnitudes, up to the current month: the Past Balance line) and `original_schedule` (the
  projection from the first Starting Balance month with the original balance and the minimum payment) are additions
  to the ticket's shape. `escrow_amount` is null for non-mortgages (B10).
- `paired_category.target` is null or `{ amount, cadence, behavior, day_of_month, due_date, needed_this_month }` from
  the plan month's `CategoryTargetMonth`; `available` is the category's Available in that month.
- D1 calls: the plan, the account, one `db.batch` of `loanMonthsQuery` (unchanged), and for a paired loan the plan
  month read (`getPlanMonth`, already constant). The count is the same for 10 and 100 payments and for 1 and 24
  months; a counting test proves it. No new `IN` list.

## Pairing from the loan page

Get Started opens a "Pair a Category" dialog with the EXF-482 copy and an existing-category select (the same groups
as the create flow: visible, not Credit Card Payments). It saves through
`PUT /api/v1/budgets/{id}/accounts/{loan_id}/paired-category { category_id }`, MCP `pair_loan_category`
(`services/loan-pairing.ts`): the same checks as EXF-482's D5, then one `db.batch` of the guarded account update and
an `account` change_log row (before/after `paired_category_id`), so undo already handles it (`services/undo.ts`
allows `paired_category_id`). "Create a new category" is not offered here (it needs the create flow's group and
category batch in `services/accounts.ts`).

## Web

- `pages/account.tsx` renders `loan/LoanPage.tsx` for the six loan types: tiles, banner, progress card, paired
  panel, then the unchanged `LoanActivity`.
- Tiles: Remaining Balance, Interest Rate ("6%"), Minimum Payment, Escrow (mortgage only), Payoff Date ("Nov 2056").
- Progress card (collapsible): "Balance Remaining $200,000 (100.0%)", "Open Payoff Simulator", the SVG line chart
  (Past Balance solid, Original Payment Schedule, Current Track dashed) with a legend whose info tooltips carry the
  ticket's text, and the banner sentence. The chart is drawn like `reflect/NetWorthChart.tsx` and
  `reflect/AgeOfMoneyChart.tsx` (the app's own SVG; no charting dependency exists, none is added).
- "Open Payoff Simulator" and "Try It Now" open `loan/PayoffSimulatorDialog.tsx`, titled "Loan Payoff Simulator":
  the as-is figures (Required Minimum Payment, Monthly Payment, Payoff Date, "You have N payments remaining on your
  loan.", Interest Remaining, Time Remaining) and the chart, with Done. EXF-544 adds the inputs, the Simulation line
  and Copy to plan.
- Colours come only from `shell/tokens.css`. Copy lives in `packages/schema/src/loan-summary.ts`.

## Departures

- **Simulator shell.** AC5's simulator is EXF-544's (blocked by this ticket). This Build opens its dialog with the
  read-only as-is view; the calculator is EXF-544.
- **Pairing write added** (above) so Get Started can save; existing categories only.
- **Additions to the summary shape**: `payment_used`, `payment_source`, `interest_remaining`, `history`,
  `original_schedule`.
- **Share Your Progress** is omitted, as the ticket says.
- **The header's "Updated …" line** is not drawn (B13).
- **The banner's dismissal** is not persisted across reloads (B12).

## Build notes

- `durationText` lives in `packages/schema/src/loan-summary.ts` (the schema package cannot import core), not in core;
  core's change is the one file `loan-projection.ts`.
- Pairing refusals use the account-closed code `account_closed` for a closed loan (no pairing a closed loan) and
  `unprocessable_entity` with EXF-482's text for an unusable category; the route maps `TransactionRefused`.
- The paired panel's Target rows use a small local wording (Frequency "Monthly", Due "by the End of the Month" or
  "by the Nth"): no `target-wording.ts` exists in the repo. EXF-545 replaces it with "Monthly Debt Payment".
- Tile groups are `role="group"` with the tile's label as the name; the dismissal (B12) is a module-level set.
- The paired-panel pill colours use `shell/tokens.css` only (`--statusPositive`, `--statusNegative`,
  `--inputBackground`), not the plan grid's local tokens.
- D1 counts proven in `loan-summary-calls.test.ts`: constant for 10 vs 100 payments and 1 vs 24 months, paired and
  unpaired; the pairing write is constant too.

## Not in this Build

EXF-542 (Add Activity), EXF-543 (Update Balance, the header's "Updated …" line and frozen rows), EXF-544 (the
simulator's inputs, Simulation line, savings and Copy to plan), EXF-545 (Debt Payment Target, "Monthly Debt Payment"
wording, the paired inspector; "Create Debt Payment Target" here links to the plan until then).
