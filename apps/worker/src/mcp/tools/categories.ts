import { z } from "zod";
import { addCategory, moveCategory, unhideAll, updateCategory } from "../../services/categories";
import { categoryUsage, deleteCategory } from "../../services/category-delete";
import type { McpToolDef } from "../types";

const budget_id = z.string().min(1);
const category_id = z.string().min(1);

export const tools: McpToolDef[] = [
  {
    name: "create_category",
    description:
      "Create a category at the top of a group. The name is trimmed and must be unique in the group (case-insensitive). Returns {category} with id, group_id, name, sort, hidden and note. (Not for the Credit Card Payments group or its payment categories: that is a 422.)",
    inputSchema: z.object({ budget_id, group_id: z.string().min(1), name: z.string() }),
    run: async (input: { budget_id: string; group_id: string; name: string }, { env, actor }) => ({
      category: await addCategory(env, actor, input),
    }),
  },
  {
    name: "rename_category",
    description:
      "Rename a category. The name is trimmed and must be unique in its group. Returns {category} with id, group_id, name, sort, hidden and note. (Not for the Credit Card Payments group or its payment categories: that is a 422.)",
    inputSchema: z.object({ budget_id, category_id, name: z.string() }),
    run: async (
      input: { budget_id: string; category_id: string; name: string },
      { env, actor },
    ) => ({
      category: await updateCategory(env, actor, input),
    }),
  },
  {
    name: "set_category_hidden",
    description:
      "Hide or unhide a category. Hidden categories still count in Ready to Assign. Unhiding a category in a hidden group brings the group back with only that category. Returns {category} with id, group_id, name, sort, hidden and note. (Not for the Credit Card Payments group or its payment categories: that is a 422.)",
    inputSchema: z.object({ budget_id, category_id, hidden: z.boolean() }),
    run: async (
      input: { budget_id: string; category_id: string; hidden: boolean },
      { env, actor },
    ) => ({ category: await updateCategory(env, actor, input) }),
  },
  {
    name: "set_category_note",
    description:
      "Set or clear a category's note: plain text, the same in every month, at most 5000 characters. Line breaks inside are kept and the ends are trimmed; an empty or whitespace-only note, or null, clears it. Returns {category} with id, group_id, name, sort, hidden and note.",
    inputSchema: z.object({ budget_id, category_id, note: z.string().max(5000).nullable() }),
    run: async (
      input: { budget_id: string; category_id: string; note: string | null },
      { env, actor },
    ) => ({ category: await updateCategory(env, actor, input) }),
  },
  {
    name: "move_category",
    description:
      "Move a category within its group or to another group, placing it before_category_id or after_category_id (a category of group_id); with neither it goes last. The order is the same in every month. Ready to Assign and every month's Assigned/Activity/Available stay with the category; only the group subtotals change. Returns {category} with id, group_id, name, sort, hidden and note. (A credit card payment category can only be reordered inside the Credit Card Payments group and no other category can enter it: that is a 422; so is a name already used in the destination group or a before/after category that is not in group_id.)",
    inputSchema: z.object({
      budget_id,
      category_id,
      group_id: z.string().min(1),
      before_category_id: z.string().min(1).optional(),
      after_category_id: z.string().min(1).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        category_id: string;
        group_id: string;
        before_category_id?: string;
        after_category_id?: string;
      },
      { env, actor },
    ) => ({ category: await moveCategory(env, actor, input) }),
  },
  {
    name: "delete_category",
    description:
      "Delete a category. If it has transactions or assigned amounts, reassign_to (another category) is required: its transactions and assigned amounts move to that category, and Ready to Assign is unchanged, except that in later months it rises when the merge cancels cash overspending. Returns {deleted} with category_ids, group_id, reassigned_to, transactions_moved and months_merged. Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01. (Not for the Credit Card Payments group or its payment categories: that is a 422.)",
    inputSchema: z.object({ budget_id, category_id, reassign_to: z.string().min(1).optional() }),
    run: async (
      input: { budget_id: string; category_id: string; reassign_to?: string },
      { env, actor },
    ) => ({ deleted: await deleteCategory(env, actor, input) }),
  },
  {
    name: "unhide_all_categories",
    description:
      "Unhide every hidden category and category group in the plan; no money changes. Returns {unhidden} with group_ids and category_ids (the rows that were unhidden).",
    inputSchema: z.object({ budget_id }),
    run: async (input: { budget_id: string }, { env, actor }) => ({
      unhidden: await unhideAll(env, actor, input.budget_id),
    }),
  },
  {
    name: "get_category_usage",
    description:
      "Read how much a category is used, to decide whether deleting it needs a reassignment. Returns {usage} with category_count, transaction_count, has_assigned and has_history. Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01.",
    inputSchema: z.object({ budget_id, category_id }),
    run: async (input: { budget_id: string; category_id: string }, { env }) => ({
      usage: await categoryUsage(env, input.budget_id, input.category_id),
    }),
  },
];
