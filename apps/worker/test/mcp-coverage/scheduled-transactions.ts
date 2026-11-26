import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/scheduled-transactions": { tool: "list_scheduled_transactions" },
  "POST /budgets/{budget_id}/scheduled-transactions": { tool: "create_scheduled_transaction" },
  "GET /budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}": {
    tool: "get_scheduled_transaction",
  },
  "PATCH /budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}": {
    tool: "update_scheduled_transaction",
  },
  "DELETE /budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}": {
    tool: "delete_scheduled_transaction",
  },
  "POST /budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}/enter": {
    tool: "enter_scheduled_transaction_now",
  },
  "POST /budgets/{budget_id}/scheduled-transactions/bulk": {
    tool: [
      "enter_scheduled_transaction_now",
      "delete_scheduled_transaction",
      "bulk_update_scheduled_transactions",
    ],
    note: "the register's selection; enter and delete take one id per call, categorize, flag, memo and move go through the bulk tool",
  },
  "POST /budgets/{budget_id}/scheduled-transactions/enter-due": {
    tool: "enter_due_scheduled_transactions",
  },
  "GET /budgets/{budget_id}/months/{month}/categories/{category_id}/upcoming": {
    tool: "list_upcoming_for_category",
  },
};
