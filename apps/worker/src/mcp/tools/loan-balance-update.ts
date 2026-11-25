import { loanBalanceUpdateFields } from "@budget/schema/loan-balance-update";
import { z } from "@hono/zod-openapi";
import { updateLoanBalance } from "../../services/loan-balance-update";
import { dates, Id, LINK_STATE, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "update_loan_balance",
    description: `Update a loan's balance (a mortgage, auto, student, personal, medical or other debt account), as the app's Update Balance wizard does. Every interest and escrow line of the loan up to the month of today becomes Reconciled (frozen: it stays when a payment is deleted); an edited line is replaced by one reconciled line with its sum; a balance adjustment (payee "Reconciliation Balance Adjustment", memo "Entered automatically by Budget", no category, not Ready to Assign) covers what remains so the account balance becomes balance; and the account's last_reconciled_at is set (the loan summary's balance_updated_at). balance is the balance at the lender, signed like the account balance (-199500000 for 199,500.00 owed). interest_rate (and, on a mortgage only, escrow_amount) re-estimates the current month's estimated lines and, with keep_rate / keep_escrow (default true), is stored on the loan going forward; a non-mortgage with escrow_amount is a tool error. current_balance, when sent, is the balance you saw: if it is not the loan's balance, the call is a tool error balance_changed and nothing is written. With preview true nothing is written and adjustment_amount is what would be added. ${MONEY} ${dates("today", "date")} today's month is the last month frozen and today is the adjustment's date; it defaults to the UTC date. Returns { adjustment_amount, previous_balance, balance, balance_updated_at, account, adjustment } (adjustment null when there was no difference or in a preview). Each account also has ${LINK_STATE}. ${timestamps(["balance_updated_at", "updated_at", "created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["balance_updated_at", "last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id, ...loanBalanceUpdateFields }),
    run: async (
      input: { budget_id: string; account_id: string } & z.input<
        z.ZodObject<typeof loanBalanceUpdateFields>
      >,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...rest } = input;
      return updateLoanBalance(env, actor, budget_id, account_id, rest);
    },
  },
];
