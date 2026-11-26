import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/views": { tool: "list_views" },
  "POST /budgets/{budget_id}/views": { tool: "create_view" },
  "POST /budgets/{budget_id}/views/reorder": { tool: "reorder_views" },
  "PATCH /budgets/{budget_id}/views/{view_id}": { tool: "update_view" },
  "DELETE /budgets/{budget_id}/views/{view_id}": { tool: "delete_view" },
};
