import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /bank-connections": { tool: "list_bank_connections" },
  "POST /bank-connections/link-token": { excluded: "needs Plaid Link in a browser" },
  "POST /bank-connections": { excluded: "needs Plaid Link in a browser" },
  "GET /institutions": { excluded: "serves the bank search of the browser Plaid Link flow" },
  "GET /institutions/popular": {
    excluded: "serves the bank search of the browser Plaid Link flow",
  },
};
