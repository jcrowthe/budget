import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets": { tool: "list_budgets" },
  "POST /budgets": { tool: "create_budget" },
  "GET /budgets/{id}": { tool: "get_budget" },
  "GET /budgets/{budget_id}/export": { tool: "export_budget" },
  "POST /budgets/import": { tool: "import_budget_export" },
  "POST /budgets/import/{import_id}/continue": { tool: "continue_budget_import" },
  "DELETE /budgets/import/{import_id}": { tool: "cancel_budget_import" },
  "PATCH /budgets/{id}": {
    tool: ["update_budget", "set_expected_income"],
    note: "opened is left out: it is the interface recording an open, not a change",
  },
  "DELETE /budgets/{id}": { tool: "delete_budget" },
};
