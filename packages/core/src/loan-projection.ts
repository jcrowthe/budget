import { estimatedInterest, type LoanTerms, runLoan } from "./loan-engine";
import { addMonths, type Month } from "./month";

export type ProjectionIn = {
  /** Owed, milliunits >= 0. */
  balance: number;
  payment: number;
  from: Month;
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
  const schedule = [{ month: input.from, balance: b }];
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
