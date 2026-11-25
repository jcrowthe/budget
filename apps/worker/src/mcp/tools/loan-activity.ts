import { IsoDate, Month as MonthSchema } from "@budget/schema/common/dates";
import { Milliunits } from "@budget/schema/common/money";
import { z } from "zod";
import { getLoanActivity } from "../../services/loan-activity";
import { recordLoanPayment } from "../../services/loan-payments";
import { dates, Id, MONEY, MONTH, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_loan_activity",
    description: `A loan's Account Activity for one month (a mortgage, auto, student, personal, medical or other debt account). Returns { month, ending_balance, principal, payments, interest, escrow, other, last_payment_from_account_id }: payments are the transfers from on-plan accounts (transaction_id, date, amount, memo, cleared, from_account_id, from_account_name); interest is null or { amount, state, estimated_total, still_due, edited_on } and escrow null or { amount, state } where state is estimated (computed from the payments), edited or reconciled (stored lines); edited_on is the date of the latest stored interest row that is not reconciled when state is edited (add_loan_activity writes one), else null; both are null in a month without a payment; other holds every other row (transaction_id, date, amount, label, memo; a row with no payee is labelled Fee or Charge when negative and Credit when positive); last_payment_from_account_id is the source Record Payment preselects, or null. ${MONEY} still_due is a magnitude. ${MONTH} The default month is the current UTC month. A non-loan account is a tool error (not_a_loan_account). ${dates("date")}`,
    inputSchema: z.object({ budget_id: Id, loan_account_id: Id, month: MonthSchema.optional() }),
    run: async (input: { budget_id: string; loan_account_id: string; month?: string }, { env }) =>
      getLoanActivity(env, input.budget_id, input.loan_account_id, input.month),
  },
  {
    name: "record_loan_payment",
    description: `Record a payment to a loan from an on-plan cash account (checking, savings or cash): creates the transfer pair in one step, cash -amount and loan +amount, with the cash side categorized to the loan's paired category when it has a live one. The loan's interest and escrow for the month are computed from its payments (see get_loan_activity). Without amount it pays the Available of the paired category in the date's month; with no paired category or nothing available it is a tool error (amount_required). Paying from a card, a tracking account or the loan itself is a tool error (invalid_payment_source), and so is a closed account (account_closed) or an account that is not a loan (not_a_loan_account). ${MONEY} The default date is today (UTC). Returns { amount, from_transaction, to_transaction }, each as get_transaction returns it. ${dates("date")} ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      loan_account_id: Id,
      from_account_id: Id,
      amount: Milliunits.positive().optional(),
      date: IsoDate.optional(),
      memo: z.string().max(500).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        loan_account_id: string;
        from_account_id: string;
        amount?: number;
        date?: string;
        memo?: string;
      },
      { env, actor },
    ) => {
      const { budget_id, loan_account_id, ...rest } = input;
      return recordLoanPayment(env, actor, budget_id, loan_account_id, rest);
    },
  },
];
