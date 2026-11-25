import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "POST /budgets/{budget_id}/categories": { tool: "create_category" },
  "POST /budgets/{budget_id}/categories/unhide_all": { tool: "unhide_all_categories" },
  "PATCH /budgets/{budget_id}/categories/{category_id}": {
    tool: ["rename_category", "set_category_hidden", "set_category_note"],
    note: "the rename, hide and note tools split the one PATCH; none changes anything else",
  },
  "POST /budgets/{budget_id}/categories/{category_id}/move": { tool: "move_category" },
  "DELETE /budgets/{budget_id}/categories/{category_id}": { tool: "delete_category" },
  "GET /budgets/{budget_id}/categories/{category_id}/usage": { tool: "get_category_usage" },
};
