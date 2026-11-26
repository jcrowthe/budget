import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "PUT /budgets/{budget_id}/transactions/{transaction_id}/image": {
    tool: "attach_transaction_image",
  },
  "GET /budgets/{budget_id}/transactions/{transaction_id}/image": {
    excluded: "binary image stream for the browser; agents read has_image, then attach or delete",
  },
  "DELETE /budgets/{budget_id}/transactions/{transaction_id}/image": {
    tool: "delete_transaction_image",
  },
};
