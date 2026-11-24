import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/payees": { tool: "list_payees" },
  "PATCH /budgets/{budget_id}/payees/{payee_id}": {
    tool: ["rename_payee", "set_payee_hidden", "set_payee_category_mode"],
  },
  "DELETE /budgets/{budget_id}/payees/{payee_id}": { tool: "delete_payee" },
  "POST /budgets/{budget_id}/payees/bulk": { tool: "bulk_update_payees" },
  "GET /budgets/{budget_id}/payees/{payee_id}/transactions": { tool: "list_payee_transactions" },
  "GET /budgets/{budget_id}/payees/{payee_id}/recent-transactions": {
    tool: "list_payee_recent_transactions",
  },
  "GET /budgets/{budget_id}/payees/{payee_id}/rename-rules": { tool: "list_payee_rename_rules" },
  "POST /budgets/{budget_id}/payees/{payee_id}/rename-rules": { tool: "create_payee_rename_rule" },
  "PATCH /budgets/{budget_id}/payees/{payee_id}/rename-rules/{rule_id}": {
    tool: "update_payee_rename_rule",
  },
  "DELETE /budgets/{budget_id}/payees/{payee_id}/rename-rules/{rule_id}": {
    tool: "delete_payee_rename_rule",
  },
};
