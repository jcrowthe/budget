import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/accounts/{account_id}/view_settings": {
    tool: "get_account_view_settings",
  },
  "PUT /budgets/{budget_id}/accounts/{account_id}/view_settings": {
    tool: "update_account_view_settings",
  },
  "GET /budgets/{budget_id}/view_settings/all_accounts": { tool: "get_all_accounts_view_settings" },
  "PUT /budgets/{budget_id}/view_settings/all_accounts": {
    tool: "update_all_accounts_view_settings",
  },
};
