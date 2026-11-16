import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/ui-state": { excluded: "interface state" },
  "PUT /budgets/{budget_id}/ui-state": { excluded: "interface state" },
};
