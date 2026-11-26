import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "POST /budgets/{id}/fresh-start": { tool: "fresh_start_budget" },
};
