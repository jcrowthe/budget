import { z } from "zod";
import { addCategory, unhideAll, updateCategory } from "../../services/categories";
import { categoryUsage, deleteCategory } from "../../services/category-delete";
import type { McpToolDef } from "../types";

const budget_id = z.string().min(1);
const category_id = z.string().min(1);

export const tools: McpToolDef[] = [
  {
    name: "create_category",
    description:
      "Create a category at the top of a group. The name is trimmed and must be unique in the group (case-insensitive). Returns {category} with id, group_id, name, sort and hidden.",
    inputSchema: z.object({ budget_id, group_id: z.string().min(1), name: z.string() }),
    run: async (input: { budget_id: string; group_id: string; name: string }, { env, actor }) => ({
      category: await addCategory(env, actor, input),
    }),
  },
  {
    name: "rename_category",
    description:
      "Rename a category. The name is trimmed and must be unique in its group. Returns {category} with id, group_id, name, sort and hidden.",
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
      "Hide or unhide a category. Hidden categories still count in Ready to Assign. Unhiding a category in a hidden group brings the group back with only that category. Returns {category} with id, group_id, name, sort and hidden.",
    inputSchema: z.object({ budget_id, category_id, hidden: z.boolean() }),
    run: async (
      input: { budget_id: string; category_id: string; hidden: boolean },
      { env, actor },
    ) => ({ category: await updateCategory(env, actor, input) }),
  },
  {
    name: "delete_category",
    description:
      "Delete a category. If it has transactions or assigned amounts, reassign_to (another category) is required: its transactions and assigned amounts move to that category, and Ready to Assign is unchanged, except that in later months it rises when the merge cancels cash overspending. Returns {deleted} with category_ids, group_id, reassigned_to, transactions_moved and months_merged. Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01.",
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
