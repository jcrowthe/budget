import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/accounts": { tool: "list_accounts" },
  "POST /budgets/{budget_id}/accounts": { tool: "create_account" },
  "PUT /budgets/{budget_id}/accounts/order": { tool: "reorder_accounts" },
  "GET /budgets/{budget_id}/accounts/{account_id}": { tool: "get_account" },
  "PATCH /budgets/{budget_id}/accounts/{account_id}": { tool: "update_account" },
  "POST /budgets/{budget_id}/accounts/{account_id}/adjust-balance": {
    tool: "adjust_account_balance",
  },
  "POST /budgets/{budget_id}/accounts/{account_id}/close": { tool: "close_account" },
  "POST /budgets/{budget_id}/accounts/{account_id}/reopen": { tool: "reopen_account" },
  "POST /budgets/{budget_id}/accounts/{account_id}/reconcile": { tool: "reconcile_account" },
  "DELETE /budgets/{budget_id}/accounts/{account_id}": { tool: "delete_account" },
  "GET /budgets/{budget_id}/account-summary": { tool: "get_account_summary" },
  "POST /budgets/{budget_id}/accounts/from-bank": { tool: "create_accounts_from_bank" },
  "POST /budgets/{budget_id}/accounts/{account_id}/link": { tool: "link_account" },
  "DELETE /budgets/{budget_id}/accounts/{account_id}/link": { tool: "unlink_account" },
  "POST /budgets/{budget_id}/accounts/{account_id}/payments": {
    tool: ["pay_credit_card", "record_loan_payment"],
  },
  "GET /budgets/{budget_id}/accounts/{account_id}/activity": { tool: "get_loan_activity" },
  "GET /budgets/{budget_id}/accounts/{account_id}/summary": { tool: "get_loan_summary" },
  "POST /budgets/{budget_id}/accounts/{account_id}/activity": { tool: "add_loan_activity" },
  "PATCH /budgets/{budget_id}/accounts/{account_id}/activity/{transaction_id}": {
    tool: "update_loan_activity",
  },
  "DELETE /budgets/{budget_id}/accounts/{account_id}/activity/{transaction_id}": {
    tool: "delete_loan_activity",
  },
  "POST /budgets/{budget_id}/accounts/{account_id}/payoff-simulation": {
    tool: "simulate_loan_payoff",
  },
  "POST /budgets/{budget_id}/accounts/{account_id}/balance-update": { tool: "update_loan_balance" },
  "PUT /budgets/{budget_id}/accounts/{account_id}/paired-category": { tool: "pair_loan_category" },
};
