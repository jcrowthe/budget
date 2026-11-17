import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const toolsWithoutOperation: Record<string, string> = {};

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/months/{month}/categories/{category_id}/transactions": {
    tool: "list_category_transactions",
  },
};
