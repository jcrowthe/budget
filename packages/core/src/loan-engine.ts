import type { AccountType } from "./account-types";
import type { Month } from "./month";

/** The payee systems of frozen (stored) interest and escrow rows: the hook EXF-543's balance update writes. */
export const LOAN_INTEREST_SYSTEM = "loan_interest";
export const LOAN_ESCROW_SYSTEM = "loan_escrow";

/** "6" -> 6000n, "4.5" -> 4500n, "6.125" -> 6125n; no rate -> 0n. Thousandths of a percent point. */
export function rateThousandths(rate: string | null): bigint {
  if (rate === null || rate.trim() === "") return 0n;
  const [whole = "0", frac = ""] = rate.trim().split(".");
  const w = BigInt(whole === "" ? "0" : whole);
  return w * 1000n + BigInt(`${frac}000`.slice(0, 3));
}

/** Interest for one month on `owed` milliunits: owed x rate / 100 / 12, half away from zero, to 10 milliunits. */
export function estimatedInterest(owed: number, rate: string | null): number {
  if (owed <= 0) return 0;
  // owed x thousandths / (1000 x 100 x 12), in units of 10 milliunits: divide by a further 10.
  const num = BigInt(owed) * rateThousandths(rate);
  const den = 1000n * 100n * 12n * 10n;
  const units = (num * 2n + den) / (den * 2n); // round half up (num >= 0)
  return Number(units * 10n);
}

export type LoanTerms = {
  type: AccountType;
  interest_rate: string | null;
  escrow_amount: number | null;
};

type Frozen = { amount: number; reconciled: boolean };

export type LoanMonthIn = {
  month: Month;
  /** Sum of payments (inflows from an on-plan account). */
  payments: number;
  /** Starting Balance rows dated in the month. */
  starting: number;
  /** Every other stored row, frozen interest and escrow rows excluded. */
  other: number;
  /** Frozen interest / escrow rows (sum, negative); reconciled when every such row is reconciled. */
  interest_rows: null | Frozen;
  escrow_rows: null | Frozen;
};

export type LineState = "estimated" | "edited" | "reconciled";

export type LoanMonthOut = {
  month: Month;
  opening: number;
  payments: number;
  starting: number;
  other: number;
  principal: number;
  interest: null | { amount: number; state: LineState; estimated_total: number; still_due: number };
  escrow: null | { amount: number; state: LineState };
  /** The computed (not stored) part of the month's charges, <= 0. */
  estimated: number;
  closing: number;
};

/** Negation that never yields -0. */
const neg = (n: number): number => (n === 0 ? 0 : -n);
const stateOf = (f: Frozen): LineState => (f.reconciled ? "reconciled" : "edited");

/** Folds the loan's months in order. See docs/loan-engine-design.md. */
export function runLoan(terms: LoanTerms, months: readonly LoanMonthIn[]): LoanMonthOut[] {
  const sorted = [...months].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const out: LoanMonthOut[] = [];
  let prev = 0;
  for (const m of sorted) {
    const owed = Math.max(0, -(prev + m.starting));
    const estimate = estimatedInterest(owed, terms.interest_rate);
    const P = m.payments;
    const hasEscrowRule = terms.type === "mortgage";

    let escrow: LoanMonthOut["escrow"] = null;
    let escrowMag = 0;
    let escrowEstimated = 0;
    if (m.escrow_rows) {
      escrowMag = -m.escrow_rows.amount;
      escrow = { amount: m.escrow_rows.amount, state: stateOf(m.escrow_rows) };
    } else if (P > 0 && hasEscrowRule) {
      escrowMag = Math.min(terms.escrow_amount ?? 0, P);
      escrowEstimated = escrowMag;
      escrow = { amount: neg(escrowMag), state: "estimated" };
    }

    let interest: LoanMonthOut["interest"] = null;
    let interestMag = 0;
    let interestEstimated = 0;
    if (m.interest_rows) {
      interestMag = -m.interest_rows.amount;
      interest = {
        amount: m.interest_rows.amount,
        state: stateOf(m.interest_rows),
        estimated_total: m.interest_rows.amount,
        still_due: 0,
      };
    } else if (P > 0) {
      interestMag = Math.min(estimate, Math.max(0, P - escrowMag));
      interestEstimated = interestMag;
      interest = {
        amount: neg(interestMag),
        state: "estimated",
        estimated_total: neg(estimate),
        still_due: estimate - interestMag,
      };
    }

    const principal = Math.max(0, P - escrowMag - interestMag);
    const frozen = (m.interest_rows?.amount ?? 0) + (m.escrow_rows?.amount ?? 0);
    const estimated = neg(interestEstimated + escrowEstimated);
    const closing = prev + P + m.starting + m.other + frozen + estimated;
    out.push({
      month: m.month,
      opening: prev,
      payments: P,
      starting: m.starting,
      other: m.other,
      principal,
      interest,
      escrow,
      estimated,
      closing,
    });
    prev = closing;
  }
  return out;
}

/** The month's result, or an empty month carrying the previous closing (0 before the first row). */
export function loanAt(results: readonly LoanMonthOut[], month: Month): LoanMonthOut {
  let prev = 0;
  for (const r of results) {
    if (r.month === month) return r;
    if (r.month < month) prev = r.closing;
  }
  return {
    month,
    opening: prev,
    payments: 0,
    starting: 0,
    other: 0,
    principal: 0,
    interest: null,
    escrow: null,
    estimated: 0,
    closing: prev,
  };
}

/** The computed part of the loan's balance: what balances add to the stored rows. */
export function estimatedTotal(results: readonly LoanMonthOut[]): number {
  return results.reduce((n, r) => n + r.estimated, 0);
}
