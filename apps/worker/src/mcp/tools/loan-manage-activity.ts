import { loanActivityPatchFields } from "@budget/schema/loan-manage";
import { z } from "@hono/zod-openapi";
import { deleteLoanActivity, updateLoanActivity } from "../../services/loan-manage-activity";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const REFUSALS =
  "A line reconciled by update_loan_balance (a reconciled interest line, escrow, or the Balance adjustment row) is a tool error reconciled_line; the Initial Balance row, a payment or a payee's row is not_editable_activity; a closed account (account_closed), a non-loan account (not_a_loan_account) and an unknown plan, account or row are tool errors; a balance that changed while writing is balance_changed (nothing written).";
const IDS = { budget_id: Id, loan_account_id: Id, transaction_id: Id };

export const tools: McpToolDef[] = [
  {
    name: "update_loan_activity",
    description: `Edit a recorded line of a loan's Account Activity, as the app's Edit button does. transaction_id is the id get_loan_activity gives: interest.transaction_id for an edited interest line (editable true), or an Other row's transaction_id (a Fee or Charge or a Credit, editable true). An interest line is edited as a whole: amount is the line's new total magnitude (> 0), its not-reconciled rows are replaced by one new cleared "Loan Interest" row (dated today in today's month, else the month's last day) and any reconciled part of the month is kept (an amount at or below it is a tool error). date and memo do not apply to interest. A fee or credit keeps its kind and sign: amount is a magnitude > 0, date may move it to another month, memo null clears it; send at least one of amount, date, memo. Returns { kind, transaction, balance } where transaction is the row as get_transaction returns it and balance the loan's balance after the write. ${REFUSALS} ${MONEY} ${dates("date", "today")} ${timestamps(["updated_at", "created_at"])} The change is logged and can be undone from the plan's history.`,
    inputSchema: z.object({ ...IDS, ...loanActivityPatchFields }),
    run: async (
      input: { budget_id: string; loan_account_id: string; transaction_id: string } & z.input<
        z.ZodObject<typeof loanActivityPatchFields>
      >,
      { env, actor },
    ) => {
      const { budget_id, loan_account_id, transaction_id, ...rest } = input;
      return updateLoanActivity(env, actor, budget_id, loan_account_id, transaction_id, rest);
    },
  },
  {
    name: "delete_loan_activity",
    description: `Delete a recorded line of a loan's Account Activity, as the app's Delete in the Edit dialog does. transaction_id is as for update_loan_activity. Deleting an edited interest line removes its not-reconciled rows: the line goes back to estimated (or reconciled when the month has reconciled rows). Deleting a fee or credit removes the row. Returns { kind, transaction: null, balance } with the loan's balance after the write. ${REFUSALS} ${MONEY} The change is logged and can be undone from the plan's history.`,
    inputSchema: z.object(IDS),
    run: async (
      input: { budget_id: string; loan_account_id: string; transaction_id: string },
      { env, actor },
    ) =>
      deleteLoanActivity(env, actor, input.budget_id, input.loan_account_id, input.transaction_id),
  },
];
