import { z } from "zod";
import { addCategoryGroup, updateCategoryGroup } from "../../services/categories";
import { deleteCategoryGroup, groupUsage } from "../../services/category-delete";
import type { McpToolDef } from "../types";

const budget_id = z.string().min(1);
const group_id = z.string().min(1);

export const tools: McpToolDef[] = [
  {
    name: "create_category_group",
    description:
      "Create a category group at the top of the plan's groups. The name is trimmed and must be unique in the plan (case-insensitive). Returns {category_group} with id, name, sort, hidden and collapsed.",
    inputSchema: z.object({ budget_id, name: z.string() }),
    run: async (input: { budget_id: string; name: string }, { env, actor }) => ({
      category_group: await addCategoryGroup(env, actor, input),
    }),
  },
  {
    name: "rename_category_group",
    description:
      "Rename a category group. The name is trimmed and must be unique in the plan. Returns {category_group} with id, name, sort, hidden and collapsed.",
    inputSchema: z.object({ budget_id, group_id, name: z.string() }),
    run: async (input: { budget_id: string; group_id: string; name: string }, { env, actor }) => ({
      category_group: await updateCategoryGroup(env, actor, input),
    }),
  },
  {
    name: "set_category_group_hidden",
    description:
      "Hide or unhide a category group. Unhiding brings back all its categories. Hidden rows still count in Ready to Assign. Returns {category_group} with id, name, sort, hidden and collapsed.",
    inputSchema: z.object({ budget_id, group_id, hidden: z.boolean() }),
    run: async (
      input: { budget_id: string; group_id: string; hidden: boolean },
      { env, actor },
    ) => ({
      category_group: await updateCategoryGroup(env, actor, input),
    }),
  },
  {
    name: "delete_category_group",
    description:
      "Delete a category group and its categories. If any of them has transactions or assigned amounts, reassign_to (a category outside the group) is required: its transactions and assigned amounts move to that category, and Ready to Assign is unchanged, except that in later months it rises when the merge cancels cash overspending. Returns {deleted} with category_ids, group_id, reassigned_to, transactions_moved and months_merged. Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01.",
    inputSchema: z.object({ budget_id, group_id, reassign_to: z.string().min(1).optional() }),
    run: async (
      input: { budget_id: string; group_id: string; reassign_to?: string },
      { env, actor },
    ) => ({ deleted: await deleteCategoryGroup(env, actor, input) }),
  },
  {
    name: "get_category_group_usage",
    description:
      "Read how much a category group and its categories are used, to decide whether deleting it needs a reassignment. Returns {usage} with category_count, transaction_count, has_assigned and has_history. Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01.",
    inputSchema: z.object({ budget_id, group_id }),
    run: async (input: { budget_id: string; group_id: string }, { env }) => ({
      usage: await groupUsage(env, input.budget_id, input.group_id),
    }),
  },
];
