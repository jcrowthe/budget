import { z } from "zod";
import { addCategory, updateCategory } from "../../services/categories";
import { deleteCategory } from "../../services/category-delete";
import type { McpToolDef } from "../types";

const budget_id = z.string().min(1);
const category_id = z.string().min(1);

export const tools: McpToolDef[] = [
  {
    name: "create_category",
    description:
      "Create a category at the top of a group. The name is trimmed and must be unique in the group (case-insensitive).",
    inputSchema: z.object({ budget_id, group_id: z.string().min(1), name: z.string() }),
    run: async (input: { budget_id: string; group_id: string; name: string }, { env, actor }) => ({
      category: await addCategory(env, actor, input),
    }),
  },
  {
    name: "rename_category",
    description: "Rename a category. The name is trimmed and must be unique in its group.",
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
      "Hide or unhide a category. Hidden categories still count in Ready to Assign. Unhiding a category in a hidden group brings the group back with only that category.",
    inputSchema: z.object({ budget_id, category_id, hidden: z.boolean() }),
    run: async (
      input: { budget_id: string; category_id: string; hidden: boolean },
      { env, actor },
    ) => ({ category: await updateCategory(env, actor, input) }),
  },
  {
    name: "delete_category",
    description:
      "Delete a category. If it has transactions or assigned amounts, reassign_to (another category) is required: its transactions and assigned amounts move to that category, and Ready to Assign is unchanged.",
    inputSchema: z.object({ budget_id, category_id, reassign_to: z.string().min(1).optional() }),
    run: async (
      input: { budget_id: string; category_id: string; reassign_to?: string },
      { env, actor },
    ) => ({ deleted: await deleteCategory(env, actor, input) }),
  },
];
