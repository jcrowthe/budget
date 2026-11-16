import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/accounts": { tool: "list_accounts" },
  "POST /budgets/{budget_id}/accounts": { tool: "create_account" },
  "GET /budgets/{budget_id}/accounts/{account_id}": { tool: "get_account" },
  "PATCH /budgets/{budget_id}/accounts/{account_id}": { tool: "update_account" },
  "GET /budgets/{budget_id}/account-summary": { tool: "get_account_summary" },
};
