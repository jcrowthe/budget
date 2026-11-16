import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /plaid/credentials": { excluded: "secrets are never handled by an agent" },
  "PUT /plaid/credentials": { excluded: "secrets are never handled by an agent" },
};
