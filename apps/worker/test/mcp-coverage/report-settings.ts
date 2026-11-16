import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /budgets/{budget_id}/report-settings": { excluded: "interface state" },
  "PUT /budgets/{budget_id}/report-settings/{report}": { excluded: "interface state" },
};
