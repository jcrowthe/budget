import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const toolsWithoutOperation: Record<string, string> = {};

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/moves": { tool: "list_recent_moves" },
};
