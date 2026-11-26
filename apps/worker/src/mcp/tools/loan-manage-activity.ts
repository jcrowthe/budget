import { loanActivityPatchFields } from "@budget/schema/loan-manage";
import { z } from "@hono/zod-openapi";
import { deleteLoanActivity, updateLoanActivity } from "../../services/loan-manage-activity";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const REFUSALS =
  "A line reconciled by update_loan_balance (a reconciled interest or escrow line, or the Balance adjustment row) is a tool error reconciled_line; a payment with a reconciled side (on the loan or on the cash account) is reconciled_line; a payment whose other account is closed is account_closed; the Initial Balance row, a payment with no other side, a split or a payee's row is not_editable_activity; a closed account (account_closed), a non-loan account (not_a_loan_account) and an unknown plan, account or row are tool errors; a balance that changed while writing is balance_changed (nothing written).";
const IDS = { budget_id: Id, loan_account_id: Id, transaction_id: Id };

export const tools: McpToolDef[] = [
  {
    name: "update_loan_activity",
    description: `Edit a recorded line of a loan's Account Activity, as the app's Edit button does. transaction_id is the id get_loan_activity gives: interest.transaction_id for an edited interest line or escrow.transaction_id for an edited escrow line (editable true), an Other row's transaction_id (a Fee or Charge or a Credit, editable true), or a payment's payments[].transaction_id (editable true). An interest line is edited as a whole: amount is the line's new total magnitude (> 0), its not-reconciled rows are replaced by one new cleared "Loan Interest" row (dated today in today's month, else the month's last day) and any reconciled part of the month is kept (an amount at or below it is a tool error). An escrow line is edited the same way (amount is the month's total escrow, one new cleared "Loan Escrow" row). date and memo do not apply to interest or escrow. A fee or credit keeps its kind and sign: amount is a magnitude > 0, date may move it to another month, memo null clears it; send at least one of amount, date, memo. A payment takes amount (its magnitude > 0: both sides of the transfer change together), date and memo, and no today; the cash account cannot be changed (delete and record the payment again). Returns { kind, transaction, balance } where transaction is the row as get_transaction returns it and balance the loan's balance after the write; for a payment kind is "payment" and from_transaction is the cash account's side after the write. ${REFUSALS} ${MONEY} ${dates("date", "today")} ${timestamps(["updated_at", "created_at"])} The change is logged and can be undone from the plan's history.`,
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
    description: `Delete a recorded line of a loan's Account Activity, as the app's Delete in the Edit dialog does. transaction_id is as for update_loan_activity. Deleting an edited interest or escrow line removes its not-reconciled rows: the line goes back to estimated (or reconciled when the month has reconciled rows). Deleting a fee or credit removes the row. Deleting a payment removes both sides (the loan's row and the cash account's row). Returns { kind, transaction: null, balance } (a payment also from_transaction: null) with the loan's balance after the write. ${REFUSALS} ${MONEY} The change is logged and can be undone from the plan's history.`,
    inputSchema: z.object(IDS),
    run: async (
      input: { budget_id: string; loan_account_id: string; transaction_id: string },
      { env, actor },
    ) =>
      deleteLoanActivity(env, actor, input.budget_id, input.loan_account_id, input.transaction_id),
  },
];
