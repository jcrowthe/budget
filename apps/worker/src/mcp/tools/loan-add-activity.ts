import { loanAddActivityFields } from "@budget/schema/loan-add-activity";
import { z } from "@hono/zod-openapi";
import { addLoanActivity } from "../../services/loan-add-activity";
import { dates, Id, MONEY, MONTH, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "add_loan_activity",
    description: `Add activity to a loan (a mortgage, auto, student, personal, medical or other debt account), as the app's Add Activity menu does for Add Interest, Add Escrow, Add Fee or Charge and Add Credit (a payment is record_loan_payment). kind interest records known interest for month (default the month of today; a later month is a tool error future_month): it is added to any estimated or recorded interest of that month and the month's interest line becomes edited ("Edited on" the row's date); it writes one cleared row with the payee "Loan Interest" (a later update_loan_balance replaces the edited rows with one reconciled row) and raises the debt by amount. kind escrow (a mortgage only; another loan type is a tool error unprocessable_entity) records the known escrow for month (default the month of today; a later month is a tool error future_month): amount is the month's TOTAL escrow, so unlike interest, which adds, escrow sets. Its not-reconciled rows (estimated or recorded) are replaced by one cleared row with the payee "Loan Escrow" (a reconciled part of the month is kept; a total at or below it is a tool error), the month's escrow line becomes edited ("Edited on" the row's date) and a later update_loan_balance freezes it. Escrow is paid before interest, so a total above what the payment leaves moves estimated interest into still_due (the balance moves by the extra escrow); no interest row is written. kind fee records a charge on the loan, balance -amount; kind credit records a credit or refund, balance +amount; both take date (default today) and memo, are uncleared and have no category and no payee, and appear in get_loan_activity's other as "Fee or Charge" / "Credit". Nothing here changes Ready to Assign or any category. amount is a magnitude > 0; the kind gives the sign. month with a fee or credit, or date or memo with interest or escrow, is a tool error. A closed account (account_closed) or an account that is not a loan (not_a_loan_account) is a tool error; a balance that changed while writing is balance_changed (nothing written). Returns { kind, transaction, balance } where transaction is the row as get_transaction returns it and balance the loan's balance after the write. ${MONEY} ${MONTH} ${dates("date", "today")} today is the default date and month and defaults to the UTC date. ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, loan_account_id: Id, ...loanAddActivityFields }),
    run: async (
      input: { budget_id: string; loan_account_id: string } & z.input<
        z.ZodObject<typeof loanAddActivityFields>
      >,
      { env, actor },
    ) => {
      const { budget_id, loan_account_id, ...rest } = input;
      return addLoanActivity(env, actor, budget_id, loan_account_id, rest);
    },
  },
];
