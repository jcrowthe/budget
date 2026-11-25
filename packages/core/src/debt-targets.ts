import { estimatedInterest } from "./loan-engine";
import { MAX_PROJECTION_MONTHS, projectLoan } from "./loan-projection";
import type { Milliunits } from "./money";
import type { TargetDefinition } from "./targets";

// EXF-545: the Debt Payment Target of a loan's paired category. Pure; integer milliunits. Stored in the ordinary
// target columns (no migration), as a monthly set-aside: see docs/loan-paired-category-design.md (A1, A5, A6).

export const DEBT_TARGET_TYPE = "debt_payment";

/** The storage encoding of a debt target (the fields of TargetDefinition except created_on). `last` = null day. */
export function debtTargetFields(
  amount: Milliunits,
  day: "last" | number,
): Omit<TargetDefinition, "created_on"> {
  return {
    cadence: "monthly",
    behavior: "set_aside",
    amount,
    day_of_month: day === "last" ? null : day,
    day_of_week: null,
    due_date: null,
    due_month: null,
    repeat: null,
  };
}

/** A stored definition is the debt kind when it is a monthly set-aside (on a category paired with a loan). */
export function isDebtTargetDef(def: Pick<TargetDefinition, "cadence" | "behavior">): boolean {
  return def.cadence === "monthly" && def.behavior === "set_aside";
}

export type LoanPayoffInput = {
  owed: Milliunits;
  /** The account's rate text ("6", "4.5"). */
  rate: string | null;
  /** The whole monthly payment, escrow included. */
  payment: Milliunits;
  escrow: Milliunits;
};
export type LoanPayoff = { months: number | null; interest: Milliunits; total: Milliunits };

/** The most payments counted before a payoff is called unreachable. */
export const MAX_PAYOFF_MONTHS = MAX_PROJECTION_MONTHS;

/**
 * Amortizes `owed` with P&I = payment - escrow: each month's interest is `estimatedInterest` on the balance, the
 * last payment is what is left. `months` is the number of payments (null: never within MAX_PAYOFF_MONTHS, or P&I
 * does not cover the first month's interest). `interest` is the sum over the months and `total` is owed + interest.
 */
export function loanPayoff(v: LoanPayoffInput): LoanPayoff {
  const owed = Math.max(0, v.owed);
  // One arithmetic: the loan engine's projection (loan-projection.ts). A positive escrow is the mortgage rule.
  const p = projectLoan(
    {
      type: v.escrow > 0 ? "mortgage" : "otherDebt",
      interest_rate: v.rate,
      escrow_amount: v.escrow,
    },
    { balance: owed, payment: v.payment, from: "2000-01-01" },
  );
  if (p.payments_remaining === null) return { months: null, interest: 0, total: owed };
  return {
    months: p.payments_remaining,
    interest: p.interest_total,
    total: owed + p.interest_total,
  };
}

/**
 * The smallest monthly payment (P&I to the cent, plus escrow) that pays the loan off in at most `k` payments.
 * A binary search over P&I in 10-milliunit steps: more payment never means more months.
 */
export function paymentForMonths(
  v: { owed: Milliunits; rate: string | null; escrow: Milliunits },
  k: number,
): Milliunits {
  const owed = Math.max(0, v.owed);
  const fits = (steps: number) =>
    (loanPayoff({ ...v, owed, payment: steps * 10 + v.escrow }).months ?? Infinity) <= k;
  let lo = 1;
  let hi = Math.ceil((owed + estimatedInterest(owed, v.rate)) / 10);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo * 10 + v.escrow;
}
