import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "PUT /budgets/{budget_id}/categories/{category_id}/target": {
    tool: ["set_category_target", "set_card_payment_target"],
  },
  "PUT /budgets/{budget_id}/months/{month}/categories/{category_id}/target-snooze": {
    tool: "snooze_target",
  },
  "DELETE /budgets/{budget_id}/categories/{category_id}/target": {
    tool: "delete_category_target",
  },
};
