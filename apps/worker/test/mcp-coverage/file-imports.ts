import type { Coverage } from "../mcp-coverage-types";

export const operations: Record<string, Coverage> = {
  "POST /budgets/{budget_id}/accounts/{account_id}/imports/preview": {
    tool: "preview_transactions_file",
    note: "The file is sent as content_base64 with file_name instead of a multipart upload.",
  },
  "POST /budgets/{budget_id}/accounts/{account_id}/imports": {
    tool: "import_transactions_file",
    note: "Also takes file_name and content_base64 instead of a file_id, storing the file first.",
  },
};
