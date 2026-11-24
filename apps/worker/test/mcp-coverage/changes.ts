import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "POST /budgets/{budget_id}/changes/{change_set_id}/undo": {
    excluded:
      "browser-session Undo/Redo over the web app's own stacks; an agent calls the inverse operation instead",
  },
};
