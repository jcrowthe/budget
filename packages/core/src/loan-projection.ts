import { estimatedInterest, type LoanTerms, runLoan } from "./loan-engine";
import { addMonths, type Month } from "./month";

export type ProjectionIn = {
  /** Owed, milliunits >= 0. */
  balance: number;
  payment: number;
  from: Month;
  /** A one-time extra, milliunits (negative = 0): taken off the balance at the start of month 1, before its interest. */
  extra_once?: number;
};

export type LoanProjection = {
  /** null = never pays off, or not within MAX_PROJECTION_MONTHS. */
  payments_remaining: number | null;
  payoff_month: Month | null;
  /** Sum of the projected interest, milliunits (0 when null). */
  interest_total: number;
  /** [{from, balance}, ..., {payoff_month, 0}]; [{from, balance}] when it never pays off. */
  schedule: { month: Month; balance: number }[];
};

export const MAX_PROJECTION_MONTHS = 1200;

/**
 * Amortizes month by month with `runLoan` on one synthetic month at a time, so interest, escrow and principal are
 * what Account Activity books for the same month. The last payment is capped so the balance lands on 0.
 */
export function projectLoan(terms: LoanTerms, input: ProjectionIn): LoanProjection {
  const start = Math.max(0, input.balance);
  let b = start;
  const never = (): LoanProjection => ({
    payments_remaining: null,
    payoff_month: null,
    interest_total: 0,
    schedule: [{ month: input.from, balance: start }],
  });
  if (b === 0) {
    return {
      payments_remaining: 0,
      payoff_month: input.from,
      interest_total: 0,
      schedule: [{ month: input.from, balance: 0 }],
    };
  }
  if (input.payment <= 0) return never();
  const extra = Math.max(0, input.extra_once ?? 0);
  if (extra >= b) {
    return {
      payments_remaining: 1,
      payoff_month: addMonths(input.from, 1),
      interest_total: 0,
      schedule: [
        { month: input.from, balance: start },
        { month: addMonths(input.from, 1), balance: 0 },
      ],
    };
  }
  const schedule = [{ month: input.from, balance: b }];
  b -= extra;
  let interestTotal = 0;
  for (let n = 1; n <= MAX_PROJECTION_MONTHS; n++) {
    const month = addMonths(input.from, n - 1);
    const est = estimatedInterest(b, terms.interest_rate);
    const esc = terms.type === "mortgage" ? Math.min(terms.escrow_amount ?? 0, input.payment) : 0;
    const p = Math.min(input.payment, b + est + esc);
    const [r] = runLoan(terms, [
      { month, payments: p, starting: -b, other: 0, interest_rows: null, escrow_rows: null },
    ]);
    if (!r || (r.principal <= 0 && -r.closing >= b)) return never();
    b = Math.max(0, -r.closing);
    interestTotal += -(r.interest?.amount ?? 0);
    schedule.push({ month: addMonths(input.from, n), balance: b });
    if (b === 0) {
      return {
        payments_remaining: n,
        payoff_month: addMonths(input.from, n),
        interest_total: interestTotal,
        schedule,
      };
    }
  }
  return never();
}

export type SimulationOut = {
  projection: LoanProjection;
  /** The balance the simulation starts from. */
  principal: number;
  /** principal + the simulated interest. */
  remaining_to_pay: number;
  /** The base projection's interest minus the simulation's; null when either never pays off. */
  interest_savings: number | null;
  /** The base projection's payments minus the simulation's; null when either never pays off. */
  months_saved: number | null;
};

/** The payoff simulator: `base` is the loan as it is, `change` the typed monthly payment and one-time extra. */
export function simulatePayoff(
  terms: LoanTerms,
  base: ProjectionIn,
  change: { payment: number; extra_once: number },
): SimulationOut {
  const asIs = projectLoan(terms, base);
  const projection = projectLoan(terms, {
    ...base,
    payment: change.payment,
    extra_once: change.extra_once,
  });
  const both = asIs.payments_remaining !== null && projection.payments_remaining !== null;
  const principal = Math.max(0, base.balance);
  return {
    projection,
    principal,
    remaining_to_pay: principal + projection.interest_total,
    interest_savings: both ? asIs.interest_total - projection.interest_total : null,
    months_saved: both
      ? (asIs.payments_remaining as number) - (projection.payments_remaining as number)
      : null,
  };
}
