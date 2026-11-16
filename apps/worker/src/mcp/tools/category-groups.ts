import { z } from "zod";
import { addCategoryGroup, updateCategoryGroup } from "../../services/categories";
import { deleteCategoryGroup } from "../../services/category-delete";
import type { McpToolDef } from "../types";

const budget_id = z.string().min(1);
const group_id = z.string().min(1);

export const tools: McpToolDef[] = [
  {
    name: "create_category_group",
    description:
      "Create a category group at the top of the plan's groups. The name is trimmed and must be unique in the plan (case-insensitive).",
    inputSchema: z.object({ budget_id, name: z.string() }),
    run: async (input: { budget_id: string; name: string }, { env, actor }) => ({
      category_group: await addCategoryGroup(env, actor, input),
    }),
  },
  {
    name: "rename_category_group",
    description: "Rename a category group. The name is trimmed and must be unique in the plan.",
    inputSchema: z.object({ budget_id, group_id, name: z.string() }),
    run: async (input: { budget_id: string; group_id: string; name: string }, { env, actor }) => ({
      category_group: await updateCategoryGroup(env, actor, input),
    }),
  },
  {
    name: "set_category_group_hidden",
    description:
      "Hide or unhide a category group. Unhiding brings back all its categories. Hidden rows still count in Ready to Assign.",
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
      "Delete a category group and its categories. If any of them has transactions or assigned amounts, reassign_to (a category outside the group) is required: its transactions and assigned amounts move to that category, and Ready to Assign is unchanged.",
    inputSchema: z.object({ budget_id, group_id, reassign_to: z.string().min(1).optional() }),
    run: async (
      input: { budget_id: string; group_id: string; reassign_to?: string },
      { env, actor },
    ) => ({ deleted: await deleteCategoryGroup(env, actor, input) }),
  },
];
