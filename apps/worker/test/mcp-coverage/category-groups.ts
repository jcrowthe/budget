import type { Coverage, OperationKey } from "../mcp-coverage-types";

const PATCH_NOTE =
  "collapsed is interface state and has no tool; the rename and hide tools cover the rest";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "POST /budgets/{budget_id}/category_groups": { tool: "create_category_group" },
  "PATCH /budgets/{budget_id}/category_groups/{group_id}": {
    tool: ["rename_category_group", "set_category_group_hidden"],
    note: PATCH_NOTE,
  },
  "POST /budgets/{budget_id}/category_groups/{group_id}/move": { tool: "move_category_group" },
  "DELETE /budgets/{budget_id}/category_groups/{group_id}": { tool: "delete_category_group" },
  "GET /budgets/{budget_id}/category_groups/{group_id}/usage": { tool: "get_category_group_usage" },
};
