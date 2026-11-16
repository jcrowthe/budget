import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/reports/age-of-money": { tool: "get_age_of_money" },
  "GET /budgets/{budget_id}/reports/net-worth": { tool: "get_net_worth" },
  "GET /budgets/{budget_id}/reports/net-worth/export": {
    excluded: "a CSV file download; get_net_worth returns the same figures",
  },
  "GET /budgets/{budget_id}/reports/spending-breakdown": { tool: "get_spending_breakdown" },
  "GET /budgets/{budget_id}/reports/spending-breakdown/export": {
    excluded:
      "a ZIP file download of two CSVs; get_spending_breakdown and list_report_transactions return the same figures",
  },
  "GET /budgets/{budget_id}/reports/spending-trends": { tool: "get_spending_trends" },
  "GET /budgets/{budget_id}/reports/spending-trends/export": {
    excluded:
      "a ZIP file download of two CSVs; get_spending_trends and list_report_transactions return the same figures",
  },
  "GET /budgets/{budget_id}/reports/income-expense": { tool: "get_income_expense" },
  "GET /budgets/{budget_id}/reports/income-expense/export": {
    excluded: "a CSV file download; get_income_expense returns the same figures",
  },
  "GET /budgets/{budget_id}/reports/transactions": { tool: "list_report_transactions" },
  "GET /budgets/{budget_id}/reports/range": {
    excluded:
      "interface plumbing for the date menu's presets; get_net_worth takes explicit months and defaults to the plan's first month through the current month",
  },
};
