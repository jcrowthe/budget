import type { Coverage, OperationKey } from "../mcp-coverage-types";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /health": { excluded: "service plumbing" },
  "GET /openapi.json": { excluded: "service plumbing (the document itself)" },
};
