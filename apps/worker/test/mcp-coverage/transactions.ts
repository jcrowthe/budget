import type { Coverage, OperationKey } from "../mcp-coverage-types";

// Note text shared by the two list_transactions lines.
const LIST_NOTE =
  "sort and dir are left out: display order; the tools return newest first; list_unapproved_transactions is the needs=approval_or_category filter";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/accounts/{account_id}/transactions": {
    tool: ["list_transactions", "list_unapproved_transactions"],
    note: `with account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions": {
    tool: ["list_transactions", "list_unapproved_transactions"],
    note: `without account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions/{transaction_id}": { tool: "get_transaction" },
  "POST /budgets/{budget_id}/transactions": { tool: ["create_transaction", "create_transfer"] },
  "PATCH /budgets/{budget_id}/transactions/{transaction_id}": { tool: "update_transaction" },
  "DELETE /budgets/{budget_id}/transactions/{transaction_id}": { tool: "delete_transaction" },
  "POST /budgets/{budget_id}/transactions/approve": { tool: "approve_transactions" },
  "POST /budgets/{budget_id}/transactions/reject": { tool: "reject_transactions" },
  "POST /budgets/{budget_id}/transactions/bulk": {
    tool: ["bulk_update_transactions", "delete_transactions", "flag_transactions"],
  },
  "GET /budgets/{budget_id}/transactions/export": {
    excluded:
      "a CSV file download for the browser; an agent reads the same rows with list_transactions and get_transaction",
  },
};

/** Tools that reshape REST data and have no single operation: name → reason. */
export const toolsWithoutOperation: Record<string, string> = {
  get_account_balances:
    "its figures are inside the account read and the account's transactions list",
};
