// A Build that adds a REST operation adds its MCP tool and one line here, or an
// `{ excluded: reason }` line. See docs/conventions.md step 7.
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `METHOD path`, the path relative to /api/v1 exactly as in the route file. */
export type OperationKey = `${Method} /${string}`;
export type Coverage =
  | { tool: string; note?: string } // note: what the tool leaves out, and why
  | { excluded: string }; // the reason no tool exists

const LIST_NOTE = "sort and dir are left out: display order; the tool returns newest first";

export const operations: Record<OperationKey, Coverage> = {
  // Service plumbing and things an agent must not or cannot do
  "GET /health": { excluded: "service plumbing" },
  "GET /openapi.json": { excluded: "service plumbing (the document itself)" },
  "GET /me": { excluded: "describes the caller; another Build adds the route" },
  "GET /plaid/credentials": { excluded: "secrets are never handled by an agent" },
  "PUT /plaid/credentials": { excluded: "secrets are never handled by an agent" },
  "POST /bank-connections/link-token": { excluded: "needs Plaid Link in a browser" },
  "POST /bank-connections": { excluded: "needs Plaid Link in a browser" },
  "GET /institutions": { excluded: "serves the bank search of the browser Plaid Link flow" },
  "GET /institutions/popular": {
    excluded: "serves the bank search of the browser Plaid Link flow",
  },
  "GET /budgets/{budget_id}/ui-state": { excluded: "interface state" },
  "PUT /budgets/{budget_id}/ui-state": { excluded: "interface state" },

  // Plans
  "GET /budgets": { tool: "list_budgets" },
  "POST /budgets": { tool: "create_budget" },
  "GET /budgets/{id}": { tool: "get_budget" },
  "PATCH /budgets/{id}": {
    tool: "update_budget",
    note: "opened is left out: it is the interface recording an open, not a change",
  },
  "DELETE /budgets/{id}": { tool: "delete_budget" },

  // Accounts
  "GET /budgets/{budget_id}/accounts": { tool: "list_accounts" },
  "POST /budgets/{budget_id}/accounts": { tool: "create_account" },
  "GET /budgets/{budget_id}/accounts/{account_id}": { tool: "get_account" },
  "PATCH /budgets/{budget_id}/accounts/{account_id}": { tool: "update_account" },
  "GET /budgets/{budget_id}/account-summary": { tool: "get_account_summary" },

  // Transactions
  "GET /budgets/{budget_id}/accounts/{account_id}/transactions": {
    tool: "list_transactions",
    note: `with account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions": {
    tool: "list_transactions",
    note: `without account_id; ${LIST_NOTE}`,
  },
  "GET /budgets/{budget_id}/transactions/{transaction_id}": { tool: "get_transaction" },
  "POST /budgets/{budget_id}/transactions": { tool: "create_transaction" },
  "PATCH /budgets/{budget_id}/transactions/{transaction_id}": { tool: "update_transaction" },
  "DELETE /budgets/{budget_id}/transactions/{transaction_id}": { tool: "delete_transaction" },

  // Months
  "GET /budgets/{budget_id}/months": { tool: "list_plan_months" },
  "GET /budgets/{budget_id}/months/{month}": { tool: "get_plan_month" },
  "PATCH /budgets/{budget_id}/months/{month}": { tool: "set_month_note" },
  "GET /budgets/{budget_id}/month-range": { tool: "get_month_range" },
  "PATCH /budgets/{budget_id}/months/{month}/categories/{category_id}": { tool: "set_assigned" },

  // Bank connections
  "GET /bank-connections": { tool: "list_bank_connections" },
};

/** Tools that combine or reshape REST data and have no single operation: name → reason. */
export const toolsWithoutOperation: Record<string, string> = {
  get_account_balances:
    "its figures are inside the account read and the account's transactions list",
};
