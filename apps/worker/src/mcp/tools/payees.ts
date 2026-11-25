import { PAYEE_CATEGORY_MODES } from "@budget/schema/payee-category";
import { PAYEE_BULK_MAX, PAYEE_ERRORS } from "@budget/schema/payees";
import { z } from "zod";
import {
  applyToPayees,
  combinePayees,
  deletePayee,
  listPayeeRecentTransactions,
  listPayees,
  listPayeesTransactions,
  listPayeeTransactions,
  PayeeRefused,
  updatePayee,
} from "../../services/payees";
import { dates, Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_payees",
    description:
      "List the plan's payees. Returns { payees }: each with id, name, hidden, system (starting_balance, manual_adjustment, reconciliation_adjustment, loan_interest, loan_escrow, or null for ordinary payees), last_category_id (the category of the payee's latest transaction, or null: that transaction, not the suggestion), last_inflow_to_ready_to_assign (true when that latest transaction was an inflow to Ready to Assign: last_category_id is then null, and the pair means \"Ready to Assign\"; null with false means no remembered category; split transactions do not count as a payee's latest transaction), category_mode (history, fixed or off: how the category is suggested), fixed_category_id and fixed_inflow_to_ready_to_assign (the fixed choice, a category or Ready to Assign; kept when the mode is not fixed), default_category_id and default_inflow_to_ready_to_assign (the suggestion now: null/false for off, the fixed choice for fixed, the payee's history default for history; null/false for transfer entries and system payees; see set_payee_category_mode and list_payee_recent_transactions), transfer_account_id, transaction_count (live transactions, split lines included, in the plan's accounts) and scheduled_count (live scheduled transactions), has_rules (true when the payee has renaming rules, see list_payee_rename_rules; false for transfer entries); the two counts are plain numbers, 0 for transfer entries. System payees (Starting Balance, Manual Balance Adjustment, and the reconciliation adjustment) are always included and marked by a non-null system. The app sets them: they cannot be given as payee_id for a new transaction (tool error), but every transaction's payee_id can be found in this list. An entry named 'Transfer : <account>' with a transfer_account_id stands for an open account of the plan (id 'transfer:<account id>'): it is not a real payee, so do not pass its id as payee_id; give transfer_account_id to create_transaction or update_transaction instead. Sorted by name, case-insensitive. Hidden payees only with include_hidden: true. q filters by case-insensitive substring. Use an id as payee_id in create_transaction/update_transaction, or pass payee_name to match or create one. " +
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
      "Rename an ordinary payee. Every transaction shows the new name at once. A name that differs only by case from another payee is accepted; an exact duplicate is a tool error, and so are an empty name, a system payee and a transfer entry. If the payee's old name came from a bank import (some of its transactions were imported under that name), the rule 'is <old name>' is added to it so later imports are renamed to the new name. Returns { payee }: the payee as list_payees gives it (including category_mode, fixed_category_id, fixed_inflow_to_ready_to_assign, default_category_id and default_inflow_to_ready_to_assign). " +
      MONEY,
    inputSchema: z.object({ budget_id: Id, payee_id: Id, name: z.string().max(200) }),
    run: async (input: { budget_id: string; payee_id: string; name: string }, { env, actor }) => ({
      payee: await updatePayee(env, actor, input.budget_id, input.payee_id, { name: input.name }),
    }),
  },
  {
    name: "set_payee_hidden",
    description:
      "Hide or unhide an ordinary payee. A hidden payee is not suggested when entering a transaction but keeps its transactions. Returns { payee }: the payee as list_payees gives it (with category_mode, the fixed choice and the default_* suggestion). " +
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
      "Delete an ordinary payee. Its transactions and scheduled transactions move to replacement_payee_id (an ordinary payee of the plan, hidden or not), or to no payee when it is omitted; both happen in one step. The payee's renaming rules are deleted too (the replacement does not inherit them). The replacement's default_category_id follows its new transactions. Transfer entries and system payees cannot be deleted. Returns { deleted }: id, name, replacement_payee_id, transactions_moved and scheduled_moved. " +
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
    description: `Hide, unhide or delete several ordinary payees at once (at most ${PAYEE_BULK_MAX} ids; all or none). delete moves their transactions and scheduled transactions to replacement_payee_id (an ordinary payee of the plan not among the ids) or to no payee when it is omitted. Deleting also deletes the payees' renaming rules, and the replacement's default_category_id follows its new transactions. Returns { payees, deleted }: payees holds the payees after hide or unhide; deleted lists id, name, replacement_payee_id, transactions_moved and scheduled_moved for delete. ${MONEY}`,
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
    name: "combine_payees",
    description: `Combine several ordinary payees into one (Combine and Rename): at least 2 and at most ${PAYEE_BULK_MAX} ids, in one step. The survivor is target_payee_id (one of payee_ids), else the selected payee already called name, else the first id; it is renamed to name (trimmed) and keeps its own category settings. The other payees' transactions (split lines included) and scheduled transactions move to it, their renaming rules move to it too (a rule the survivor already has, or an earlier merged payee has, with the same kind and text is dropped), and the other payees are deleted. The change is one undoable step. Errors: 422 for fewer than 2 distinct ids, a transfer entry, a system payee, an unknown id, a target outside payee_ids or an empty name; 409 when name belongs to a payee outside the selection or to a selected payee other than the target, or when the payees changed meanwhile. Returns { payee, merged, rules_moved, rules_dropped }: payee is the survivor as list_payees gives it (with its new counts), merged lists id, name, replacement_payee_id, transactions_moved and scheduled_moved for each deleted payee. ${MONEY}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_ids: z.array(Id).min(2).max(PAYEE_BULK_MAX),
      name: z.string().max(200),
      target_payee_id: Id.optional(),
    }),
    run: async (
      input: { budget_id: string; payee_ids: string[]; name: string; target_payee_id?: string },
      { env, actor },
    ) =>
      combinePayees(env, actor, input.budget_id, {
        ids: input.payee_ids,
        name: input.name,
        targetId: input.target_payee_id,
      }),
  },
  {
    name: "list_payee_transactions",
    description: `List the live transactions and scheduled transactions of a payee (payee_id) or of several payees at once (payee_ids, at most ${PAYEE_BULK_MAX}; give one of the two), newest first, at most 500. Returns { transactions, total_count }: each with id, kind (transaction or scheduled), account_id, account_name, payee_name, date, category_id, category_name, inflow_to_ready_to_assign, is_split, memo and amount; total_count counts all of them. A transfer entry or system payee is a tool error, and so is an unknown payee. For the transactions behind a payee's suggested category use list_payee_recent_transactions. ${MONEY} ${dates("transactions[].date")}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id.optional(),
      payee_ids: z.array(Id).min(1).max(PAYEE_BULK_MAX).optional(),
    }),
    run: async (input: { budget_id: string; payee_id?: string; payee_ids?: string[] }, { env }) => {
      if ((input.payee_id === undefined) === (input.payee_ids === undefined))
        throw new PayeeRefused(422, "unprocessable_entity", PAYEE_ERRORS.onePayeeArg);
      return listPayeesTransactions(
        env,
        input.budget_id,
        input.payee_ids ?? [input.payee_id as string],
      );
    },
  },
  {
    name: "set_payee_category_mode",
    description: `Choose how an ordinary payee's category is suggested. category_mode: 'history' (the payee's history default: the category held by at least 2 of its last 3 counted transactions, otherwise the stored default while that category exists, otherwise its most recent counted one), 'fixed' (always the fixed choice) or 'off' (no suggestion). 'fixed' needs a fixed choice, given now as fixed_category_id (an active category of the plan) or fixed_inflow_to_ready_to_assign: true, or already stored and still active; never both. Leaving 'fixed' keeps the stored fixed choice. An unknown or deleted category, 'fixed' without a choice, or no field at all is a tool error; so are a system payee, a transfer entry and an unknown payee. Name and hidden are set with rename_payee and set_payee_hidden. Returns { payee }: the payee as list_payees gives it: category_mode, fixed_category_id, fixed_inflow_to_ready_to_assign, and the read-only default_category_id and default_inflow_to_ready_to_assign (the suggestion now; last_category_id stays the latest transaction's). ${MONEY}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id,
      category_mode: z.enum(PAYEE_CATEGORY_MODES),
      fixed_category_id: Id.nullable().optional(),
      fixed_inflow_to_ready_to_assign: z.boolean().optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        payee_id: string;
        category_mode: "history" | "fixed" | "off";
        fixed_category_id?: string | null;
        fixed_inflow_to_ready_to_assign?: boolean;
      },
      { env, actor },
    ) => ({
      payee: await updatePayee(env, actor, input.budget_id, input.payee_id, {
        category_mode: input.category_mode,
        fixed_category_id: input.fixed_category_id,
        fixed_inflow_to_ready_to_assign: input.fixed_inflow_to_ready_to_assign,
      }),
    }),
  },
  {
    name: "list_payee_recent_transactions",
    description: `List the payee's last counted transactions, newest first (limit 1 to 10, default 3): the ones behind its history default. A counted transaction names the payee, is live, in a live account, is not a split line or a split parent and not a transfer, and has an active category or is an inflow to Ready to Assign; scheduled transactions never count, an unapproved import counts once it has a category. Same-date transactions are in the order they were entered. Returns { transactions }: each with id, account_id, date, category_id, category_name, category_group_name, inflow_to_ready_to_assign and amount. ${MONEY} ${dates("transactions[].date")}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id,
      limit: z.number().int().min(1).max(10).optional(),
    }),
    run: async (input: { budget_id: string; payee_id: string; limit?: number }, { env }) =>
      listPayeeRecentTransactions(env, input.budget_id, input.payee_id, input.limit ?? 3),
  },
];
