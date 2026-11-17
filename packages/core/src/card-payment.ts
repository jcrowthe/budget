import { addMilliunits, type Milliunits } from "./money";
import type { Month } from "./month";

// Pure arithmetic of a credit card's payment status for one month (EXF-537). No I/O.
// See docs/card-payments-design.md.

export type CardPaymentState =
  | "paid_off"
  | "overpaid"
  | "enough"
  | "overspent_categories"
  | "underfunded";

/** One card, one month (`month` is YYYY-MM-01). */
export interface CardFlow {
  accountId: string;
  month: Month;
  /** Starting Balance rows (counted in Prior even in their own month). */
  starting: Milliunits;
  /** <= 0: the other rows below zero. */
  outflows: Milliunits;
  /** >= 0: the other rows above zero. */
  inflows: Milliunits;
  /** >= 0: the part of `inflows` with a transfer account. */
  paid: Milliunits;
}

export interface CardPayment {
  state: CardPaymentState;
  underfunded: Milliunits;
  overspent_categories: Milliunits;
  current_balance: Milliunits;
  prior_balance: Milliunits;
  spending_and_outflows: Milliunits;
  interest_charges: Milliunits;
  payments_and_inflows: Milliunits;
  available: Milliunits;
  paid: Milliunits;
}

const neg = (n: Milliunits): Milliunits => (n === 0 ? 0 : -n);

/** `flows`: every CardFlow of ONE card (any months). `month`: the month shown. */
export function cardPayment(
  flows: readonly CardFlow[],
  month: Month,
  available: Milliunits,
  overspentCategories: Milliunits,
): CardPayment {
  let prior = 0;
  let spending = 0;
  let payments = 0;
  let paid = 0;
  for (const f of flows) {
    if (f.month < month) prior = addMilliunits(prior, f.starting, f.outflows, f.inflows);
    else if (f.month === month) {
      prior = addMilliunits(prior, f.starting);
      spending = addMilliunits(spending, f.outflows);
      payments = addMilliunits(payments, f.inflows);
      paid = addMilliunits(paid, f.paid);
    }
  }
  const interest = 0;
  const current = addMilliunits(prior, spending, interest, payments);
  const underfunded = Math.max(0, addMilliunits(neg(current), neg(available)));
  const state: CardPaymentState =
    available < 0
      ? "overpaid"
      : current >= 0
        ? "paid_off"
        : underfunded === 0
          ? "enough"
          : overspentCategories > 0
            ? "overspent_categories"
            : "underfunded";
  return {
    state,
    underfunded,
    overspent_categories: overspentCategories,
    current_balance: current,
    prior_balance: prior,
    spending_and_outflows: spending,
    interest_charges: interest,
    payments_and_inflows: payments,
    available,
    paid,
  };
}
