import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /bank-connections": { tool: "list_bank_connections" },
  "POST /bank-connections/link-token": { excluded: "needs Plaid Link in a browser" },
  "POST /bank-connections": { excluded: "needs Plaid Link in a browser" },
  "GET /bank-connections/{id}": { tool: "get_bank_connection" },
  "PATCH /bank-connections/{id}": { tool: "rename_bank_connection" },
  "DELETE /bank-connections/{id}": { tool: "remove_bank_connection" },
  "POST /bank-connections/{id}/link-token": {
    excluded: "update-mode token for Plaid Link, which runs only in a browser",
  },
  "POST /bank-connections/{id}/reset": {
    excluded: "records the end of Plaid Link update mode, which runs only in a browser",
  },
  "GET /institutions": { excluded: "serves the bank search of the browser Plaid Link flow" },
  "GET /institutions/popular": {
    excluded: "serves the bank search of the browser Plaid Link flow",
  },
};
