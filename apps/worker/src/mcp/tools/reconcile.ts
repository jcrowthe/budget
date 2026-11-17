import { reconcileFields } from "@budget/schema/reconcile";
import { z } from "@hono/zod-openapi";
import { reconcileAccount } from "../../services/reconcile";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const LINK_STATE =
  "connection_status (connected, delayed, login_required or broken; null when not linked) and last_synced_at (when its bank connection last synced; null when not linked or never synced)";

export const tools: McpToolDef[] = [
  {
    name: "reconcile_account",
    description: `Reconcile an open account against the bank: every cleared transaction becomes reconciled (locked) and the account's last_reconciled_at is set. statement_balance is the balance at the bank; the difference is statement_balance minus the account's cleared balance. When it is not zero and create_adjustment is not true, the call is a tool error named reconcile_difference that states the difference in milliunits. With create_adjustment true a reconciled, approved adjustment of the difference is added: payee "Reconciliation Balance Adjustment", memo "Entered automatically by Budget", category Inflow: Ready to Assign on every on-plan account (credit cards included; Ready to Assign moves by the difference) and no category on a tracking account. cleared_balance, when sent, is the cleared balance you saw: if it changed, the call is a tool error reconcile_changed with the new difference and nothing is written. A closed account is a tool error account_closed. ${MONEY} ${dates("today", "date")} today is the adjustment's date and defaults to the UTC date. Returns { account, reconciled_count, adjustment } (adjustment null when there was no difference). Each account also has ${LINK_STATE}. ${timestamps(["updated_at", "created_at", "last_reconciled_at", "last_synced_at"], ["last_reconciled_at", "last_synced_at"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id, ...reconcileFields }),
    run: async (
      input: { budget_id: string; account_id: string } & z.input<
        z.ZodObject<typeof reconcileFields>
      >,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...rest } = input;
      return reconcileAccount(env, actor, budget_id, account_id, rest);
    },
  },
];
