import type { Coverage, OperationKey } from "../mcp-coverage-types";

// Note text shared by the two list_transactions lines.
const LIST_NOTE = "sort and dir are left out: display order; the tool returns newest first";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/accounts/{account_id}/transactions": {
    tool: "list_transactions",
    note: `with account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions": {
    tool: "list_transactions",
    note: `without account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions/{transaction_id}": { tool: "get_transaction" },
  "POST /budgets/{budget_id}/transactions": { tool: ["create_transaction", "create_transfer"] },
  "PATCH /budgets/{budget_id}/transactions/{transaction_id}": { tool: "update_transaction" },
  "DELETE /budgets/{budget_id}/transactions/{transaction_id}": { tool: "delete_transaction" },
};

/** Tools that reshape REST data and have no single operation: name → reason. */
export const toolsWithoutOperation: Record<string, string> = {
  get_account_balances:
    "its figures are inside the account read and the account's transactions list",
};
