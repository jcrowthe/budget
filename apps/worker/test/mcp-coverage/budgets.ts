import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets": { tool: "list_budgets" },
  "POST /budgets": { tool: "create_budget" },
  "GET /budgets/{id}": { tool: "get_budget" },
  "GET /budgets/{budget_id}/export": { tool: "export_budget" },
  "PATCH /budgets/{id}": {
    tool: "update_budget",
    note: "opened is left out: it is the interface recording an open, not a change",
  },
  "DELETE /budgets/{id}": { tool: "delete_budget" },
};
