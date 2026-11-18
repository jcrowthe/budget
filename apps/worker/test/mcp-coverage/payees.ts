import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/payees": { tool: "list_payees" },
  "PATCH /budgets/{budget_id}/payees/{payee_id}": { tool: ["rename_payee", "set_payee_hidden"] },
  "DELETE /budgets/{budget_id}/payees/{payee_id}": { tool: "delete_payee" },
  "POST /budgets/{budget_id}/payees/bulk": { tool: "bulk_update_payees" },
  "GET /budgets/{budget_id}/payees/{payee_id}/transactions": { tool: "list_payee_transactions" },
};
