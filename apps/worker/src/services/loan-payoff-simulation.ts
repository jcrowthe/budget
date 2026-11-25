import { simulatePayoff } from "@budget/core/loan-projection";
import type { LoanPayoffSimulation } from "@budget/schema/loan-simulator";
import type { Env } from "../env";
import { readLoanSummary } from "./loan-summary";
import { TransactionRefused } from "./transactions";

/**
 * Simulate a loan's payoff: the dialog's calculation (`simulatePayoff`) over the loan summary's figures. It reads
 * through `getLoanSummary`, so it makes the summary's D1 calls and no more; it writes nothing.
 */
export async function simulateLoanPayoff(
  env: Env,
  budgetId: string,
  loanId: string,
  input: { monthly_payment?: number; extra_once?: number },
): Promise<LoanPayoffSimulation> {
  const { summary: s, terms, month } = await readLoanSummary(env, budgetId, loanId);
  const payment = input.monthly_payment ?? s.payment_used;
  if (payment === null) {
    throw new TransactionRefused(
      422,
      "no_payment",
      "the loan has no minimum payment or target: send monthly_payment",
    );
  }
  const extra = input.extra_once ?? 0;
  const sim = simulatePayoff(
    terms,
    { balance: s.remaining_balance, payment: s.payment_used ?? 0, from: month },
    { payment, extra_once: extra },
  );
  return {
    payment_used: s.payment_used,
    monthly_payment: payment,
    extra_once: extra,
    payoff_month: sim.projection.payoff_month,
    payments_remaining: sim.projection.payments_remaining,
    interest_total: sim.projection.interest_total,
    principal: sim.principal,
    remaining_to_pay: sim.remaining_to_pay,
    interest_savings: sim.interest_savings,
    months_saved: sim.months_saved,
    schedule: sim.projection.schedule,
    current: {
      payoff_month: s.payoff_month,
      payments_remaining: s.payments_remaining,
      interest_remaining: s.interest_remaining,
      schedule: s.schedule,
    },
  };
}
