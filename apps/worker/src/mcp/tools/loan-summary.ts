import { Month as MonthSchema } from "@budget/schema/common/dates";
import { z } from "zod";
import { getLoanSummary } from "../../services/loan-summary";
import { Id, MONEY, MONTH, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_loan_summary",
    description: `A loan's summary for its page (a mortgage, auto, student, personal, medical or other debt account). Returns { remaining_balance, original_balance, percent_remaining, interest_rate, minimum_payment, escrow_amount, payment_used, payment_source, payoff_month, payments_remaining, interest_remaining, schedule, history, original_schedule, paired_category, balance_updated_at }: remaining_balance is what is owed (a magnitude); original_balance and percent_remaining are null for a loan without a Starting Balance; escrow_amount is set for a mortgage only; payment_used is the paired category's monthly target when it has one (payment_source target), else the minimum payment (minimum); payoff_month and payments_remaining project the loan with the same engine as get_loan_activity from the month, and are null when the payment will not pay it off; schedule, history and original_schedule are [{ month, balance }] (balances are magnitudes: the Current Track, the Past Balance and the Original Payment Schedule); paired_category is null or { id, name, group_name, available, target } where target is null or { amount, cadence, behavior, day_of_month, due_date, needed_this_month }. ${MONEY} ${MONTH} The month is the starting point of the projection and the month whose Available is read; the default is the current UTC month. A non-loan account is a tool error (not_a_loan_account). ${timestamps(["balance_updated_at"], ["balance_updated_at"])}`,
    inputSchema: z.object({ budget_id: Id, loan_account_id: Id, month: MonthSchema.optional() }),
    run: async (input: { budget_id: string; loan_account_id: string; month?: string }, { env }) =>
      getLoanSummary(env, input.budget_id, input.loan_account_id, input.month),
  },
];
