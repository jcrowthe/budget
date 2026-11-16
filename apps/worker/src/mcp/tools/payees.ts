import { z } from "zod";
import { listPayees } from "../../services/payees";
import { Id } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_payees",
    description:
      "List the plan's payees. Returns { payees }: each with id, name, hidden, system (starting_balance, manual_adjustment, reconciliation_adjustment, or null for ordinary payees), last_category_id (the category of the payee's latest transaction, or null), last_inflow_to_ready_to_assign (true when that latest transaction was an inflow to Ready to Assign: last_category_id is then null, and the pair means \"Ready to Assign\"; null with false means no remembered category; split transactions do not count as a payee's latest transaction) and transfer_account_id. System payees (Starting Balance, Manual Balance Adjustment, and the reconciliation adjustment) are always included and marked by a non-null system. The app sets them: they cannot be given as payee_id for a new transaction (tool error), but every transaction's payee_id can be found in this list. An entry named 'Transfer : <account>' with a transfer_account_id stands for an open account of the plan (id 'transfer:<account id>'): it is not a real payee, so do not pass its id as payee_id; give transfer_account_id to create_transaction or update_transaction instead. Sorted by name, case-insensitive. Hidden payees only with include_hidden: true. q filters by case-insensitive substring. Use an id as payee_id in create_transaction/update_transaction, or pass payee_name to match or create one.",
    inputSchema: z.object({
      budget_id: Id,
      q: z.string().max(200).optional(),
      include_hidden: z.boolean().optional(),
    }),
    run: async (input: { budget_id: string; q?: string; include_hidden?: boolean }, { env }) => ({
      payees: await listPayees(env, input.budget_id, {
        q: input.q,
        includeHidden: input.include_hidden,
      }),
    }),
  },
];
