import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/reports/net-worth": { tool: "get_net_worth" },
  "GET /budgets/{budget_id}/reports/net-worth/export": {
    excluded: "a CSV file download; get_net_worth returns the same figures",
  },
  "GET /budgets/{budget_id}/reports/range": {
    excluded:
      "interface plumbing for the date menu's presets; get_net_worth takes explicit months and defaults to the plan's first month through the current month",
  },
};
