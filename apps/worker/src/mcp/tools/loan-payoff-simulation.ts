import { loanPayoffSimulationFields } from "@budget/schema/loan-simulator";
import { z } from "@hono/zod-openapi";
import { simulateLoanPayoff } from "../../services/loan-payoff-simulation";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "simulate_loan_payoff",
    description: `Simulate a loan's payoff (a mortgage, auto, student, personal, medical or other debt account), as the app's Loan Payoff Simulator does, with a monthly payment and a one-time extra. Read-only: nothing is written (set the paired category's target with set_debt_payment_target to keep a payment). monthly_payment defaults to the loan's current payment (the paired category's monthly target, else the minimum payment) and extra_once to 0; extra_once is paid at the start of the current month, before that month's interest. Returns { payment_used, monthly_payment, extra_once, payoff_month, payments_remaining, interest_total, principal, remaining_to_pay, interest_savings, months_saved, schedule, current }: payoff_month and payments_remaining are null when the payment will not pay it off (then interest_savings and months_saved are null too); principal is the remaining balance and remaining_to_pay is principal plus interest_total; interest_savings and months_saved compare with the loan as it is; schedule is the Simulation series [{ month, balance }] (balances are magnitudes); current is { payoff_month, payments_remaining, interest_remaining, schedule } for the loan as it is, the same as get_loan_summary. A loan with no payment and no monthly_payment is a tool error (no_payment); a non-loan account is a tool error (not_a_loan_account). ${MONEY} ${MONTH} The projection starts at the current UTC month.`,
    inputSchema: z.object({ budget_id: Id, loan_account_id: Id, ...loanPayoffSimulationFields }),
    run: async (
      input: { budget_id: string; loan_account_id: string } & z.input<
        z.ZodObject<typeof loanPayoffSimulationFields>
      >,
      { env },
    ) => {
      const { budget_id, loan_account_id, ...rest } = input;
      return simulateLoanPayoff(env, budget_id, loan_account_id, rest);
    },
  },
];
