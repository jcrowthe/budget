import { BUILTIN_VIEW_KEYS, CUSTOM_VIEW_CATEGORIES_MAX } from "@budget/schema/custom-views";
import { z } from "zod";
import {
  createView,
  deleteView,
  listViews,
  reorderViews,
  updateView,
} from "../../services/custom-views";
import { Id, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const fields =
  "id, name, category_ids (live categories only, hidden ones included), sort_order, created_at and updated_at";
const rules = `A custom view is a named set of the plan's categories shown as an extra chip in the Plan after the built-in views. The name is trimmed, 1 to 100 characters (blank is a tool error); duplicate names are allowed. category_ids holds at most ${CUSTOM_VIEW_CATEGORIES_MAX} live categories of the plan (an unknown one is a tool error), may be empty, and is stored once per id in the given order. A hidden category stays a member (the Plan leaves it out while it is hidden); a deleted category drops out on read, and an undone category delete brings it back. The chip order holds the four built-in keys (${BUILTIN_VIEW_KEYS.join(", ")}) and the custom view ids; All and Overspent always come first and are not in it. Built-in views can only be reordered: updating or deleting one is a tool error. Views are not undoable (they write change_log rows). Plan exports do not carry views.`;
const stamps = timestamps(["created_at", "updated_at"]);

export const tools: McpToolDef[] = [
  {
    name: "list_views",
    description: `List the plan's chips after All and Overspent. Returns { order, views }: order is every built-in key and custom view id in chip order, views the custom views in that order, each with ${fields}. ${rules} ${stamps}`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => listViews(env, input.budget_id),
  },
  {
    name: "create_view",
    description: `Create a custom view; it goes last in the chip order. Returns { view } with ${fields}. ${rules} ${stamps}`,
    inputSchema: z.object({
      budget_id: Id,
      name: z.string(),
      category_ids: z.array(Id).optional(),
    }),
    run: async (
      input: { budget_id: string; name: string; category_ids?: string[] },
      { env, actor },
    ) => ({
      view: await createView(env, actor, input.budget_id, {
        name: input.name,
        category_ids: input.category_ids,
      }),
    }),
  },
  {
    name: "update_view",
    description: `Rename a custom view and/or replace its categories (the given list is the whole new set). Give at least one of name and category_ids. Returns { view } with ${fields}. ${rules} ${stamps}`,
    inputSchema: z.object({
      budget_id: Id,
      view_id: Id,
      name: z.string().optional(),
      category_ids: z.array(Id).optional(),
    }),
    run: async (
      input: { budget_id: string; view_id: string; name?: string; category_ids?: string[] },
      { env, actor },
    ) => ({
      view: await updateView(env, actor, input.budget_id, input.view_id, {
        name: input.name,
        category_ids: input.category_ids,
      }),
    }),
  },
  {
    name: "delete_view",
    description: `Delete a custom view. Returns { view }: the view as it was, with ${fields}. ${rules} ${stamps}`,
    inputSchema: z.object({ budget_id: Id, view_id: Id }),
    run: async (input: { budget_id: string; view_id: string }, { env, actor }) => ({
      view: await deleteView(env, actor, input.budget_id, input.view_id),
    }),
  },
  {
    name: "reorder_views",
    description: `Set the chip order. ids lists every built-in key and every live custom view id exactly once (anything else is a tool error: "ids must list every view exactly once."). Returns { order, views } as list_views does. ${rules} ${stamps}`,
    inputSchema: z.object({ budget_id: Id, ids: z.array(Id) }),
    run: async (input: { budget_id: string; ids: string[] }, { env, actor }) =>
      reorderViews(env, actor, input.budget_id, { ids: input.ids }),
  },
];
