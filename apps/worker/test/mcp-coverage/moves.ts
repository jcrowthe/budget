import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "POST /budgets/{budget_id}/months/{month}/moves": { tool: "move_money" },
  "POST /budgets/{budget_id}/months/{month}/categories/{category_id}/cover": {
    tool: "cover_overspending",
  },
};
