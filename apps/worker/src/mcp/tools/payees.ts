import { PAYEE_BULK_MAX } from "@budget/schema/payees";
import { z } from "zod";
import {
  applyToPayees,
  deletePayee,
  listPayees,
  listPayeeTransactions,
  updatePayee,
} from "../../services/payees";
import { dates, Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_payees",
    description:
      "List the plan's payees. Returns { payees }: each with id, name, hidden, system (starting_balance, manual_adjustment, reconciliation_adjustment, or null for ordinary payees), last_category_id (the category of the payee's latest transaction, or null), last_inflow_to_ready_to_assign (true when that latest transaction was an inflow to Ready to Assign: last_category_id is then null, and the pair means \"Ready to Assign\"; null with false means no remembered category; split transactions do not count as a payee's latest transaction), transfer_account_id, transaction_count (live transactions, split lines included, in the plan's accounts) and scheduled_count (live scheduled transactions); the two counts are plain numbers, 0 for transfer entries. System payees (Starting Balance, Manual Balance Adjustment, and the reconciliation adjustment) are always included and marked by a non-null system. The app sets them: they cannot be given as payee_id for a new transaction (tool error), but every transaction's payee_id can be found in this list. An entry named 'Transfer : <account>' with a transfer_account_id stands for an open account of the plan (id 'transfer:<account id>'): it is not a real payee, so do not pass its id as payee_id; give transfer_account_id to create_transaction or update_transaction instead. Sorted by name, case-insensitive. Hidden payees only with include_hidden: true. q filters by case-insensitive substring. Use an id as payee_id in create_transaction/update_transaction, or pass payee_name to match or create one. " +
      MONEY,
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
  {
    name: "rename_payee",
    description:
      "Rename an ordinary payee. Every transaction shows the new name at once. A name that differs only by case from another payee is accepted; an exact duplicate is a tool error, and so are an empty name, a system payee and a transfer entry. Returns { payee }: the payee as list_payees gives it. " +
      MONEY,
    inputSchema: z.object({ budget_id: Id, payee_id: Id, name: z.string().max(200) }),
    run: async (input: { budget_id: string; payee_id: string; name: string }, { env, actor }) => ({
      payee: await updatePayee(env, actor, input.budget_id, input.payee_id, { name: input.name }),
    }),
  },
  {
    name: "set_payee_hidden",
    description:
      "Hide or unhide an ordinary payee. A hidden payee is not suggested when entering a transaction but keeps its transactions. Returns { payee }: the payee as list_payees gives it. " +
      MONEY,
    inputSchema: z.object({ budget_id: Id, payee_id: Id, hidden: z.boolean() }),
    run: async (
      input: { budget_id: string; payee_id: string; hidden: boolean },
      { env, actor },
    ) => ({
      payee: await updatePayee(env, actor, input.budget_id, input.payee_id, {
        hidden: input.hidden,
      }),
    }),
  },
  {
    name: "delete_payee",
    description:
      "Delete an ordinary payee. Its transactions and scheduled transactions move to replacement_payee_id (an ordinary payee of the plan, hidden or not), or to no payee when it is omitted; both happen in one step. Transfer entries and system payees cannot be deleted. Returns { deleted }: id, name, replacement_payee_id, transactions_moved and scheduled_moved. " +
      MONEY,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id,
      replacement_payee_id: Id.optional(),
    }),
    run: async (
      input: { budget_id: string; payee_id: string; replacement_payee_id?: string },
      { env, actor },
    ) => ({
      deleted: await deletePayee(
        env,
        actor,
        input.budget_id,
        input.payee_id,
        input.replacement_payee_id ?? null,
      ),
    }),
  },
  {
    name: "bulk_update_payees",
    description: `Hide, unhide or delete several ordinary payees at once (at most ${PAYEE_BULK_MAX} ids; all or none). delete moves their transactions and scheduled transactions to replacement_payee_id (an ordinary payee of the plan not among the ids) or to no payee when it is omitted. Returns { payees, deleted }: payees holds the payees after hide or unhide; deleted lists id, name, replacement_payee_id, transactions_moved and scheduled_moved for delete. ${MONEY}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_ids: z.array(Id).min(1).max(PAYEE_BULK_MAX),
      action: z.enum(["hide", "unhide", "delete"]),
      replacement_payee_id: Id.optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        payee_ids: string[];
        action: "hide" | "unhide" | "delete";
        replacement_payee_id?: string;
      },
      { env, actor },
    ) =>
      applyToPayees(env, actor, input.budget_id, {
        ids: input.payee_ids,
        action: input.action,
        replacementId: input.replacement_payee_id ?? null,
      }),
  },
  {
    name: "list_payee_transactions",
    description: `List a payee's live transactions and scheduled transactions, newest first, at most 500. Returns { transactions, total_count }: each with id, kind (transaction or scheduled), account_id, account_name, date, category_id, category_name, inflow_to_ready_to_assign, is_split, memo and amount; total_count counts all of them. ${MONEY} ${dates("transactions[].date")}`,
    inputSchema: z.object({ budget_id: Id, payee_id: Id }),
    run: async (input: { budget_id: string; payee_id: string }, { env }) =>
      listPayeeTransactions(env, input.budget_id, input.payee_id),
  },
];
