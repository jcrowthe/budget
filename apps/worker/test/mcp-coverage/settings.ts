import type { Coverage, OperationKey } from "../mcp-coverage-types";

const excluded =
  "interface state: per-user display options (theme, progress bars, balance style); docs/display-options-design.md";

export const operations: Partial<Record<OperationKey, Coverage>> = {
  "GET /settings": { excluded },
  "PATCH /settings": { excluded },
};
