import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/months": { tool: "list_plan_months" },
  "GET /budgets/{budget_id}/months/{month}": { tool: "get_plan_month" },
  "PATCH /budgets/{budget_id}/months/{month}": { tool: "set_month_note" },
  "GET /budgets/{budget_id}/months/{month}/summary": { tool: "get_month_summary" },
  "GET /budgets/{budget_id}/months/{month}/categories/{category_id}": {
    tool: "get_month_category",
  },
  "GET /budgets/{budget_id}/months/{month}/auto-assign": { tool: "preview_auto_assign" },
  "POST /budgets/{budget_id}/months/{month}/auto-assign": { tool: "auto_assign" },
  "GET /budgets/{budget_id}/month-range": { tool: "get_month_range" },
  "PATCH /budgets/{budget_id}/months/{month}/categories/{category_id}": { tool: "set_assigned" },
};
