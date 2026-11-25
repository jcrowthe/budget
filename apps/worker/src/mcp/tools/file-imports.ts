import { FileImportOptions, MAX_FILE_BYTES } from "@budget/schema/file-import";
import { z } from "zod";
import { FileImportRefused, importFile, previewFile } from "../../services/file-import";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

function fromBase64(text: string, name: string): Uint8Array {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out.set([bin.charCodeAt(i)], i);
    return out;
  } catch {
    throw new Error(`${name}: content_base64 is not valid base64`);
  }
}

const decoded = (text: string, name: string): Uint8Array => {
  const bytes = fromBase64(text, name);
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error("file_too_large: The file is larger than 2 MB");
  }
  return bytes;
};

/** A refused import is a tool error carrying the code and the message. */
const toolError = (e: unknown): Error =>
  e instanceof FileImportRefused
    ? new Error(`${e.code}: ${e.message}`)
    : e instanceof Error
      ? e
      : new Error(String(e));

const OPTIONS =
  "options: { no_header, mapping { date, payee, memo, outflow, inflow (column indexes or null) }, date_format, swap_inflow_outflow, import_memos, swap_payee_memo, include_before_start, remember, today (YYYY-MM-DD, required) }";

export const tools: McpToolDef[] = [
  {
    name: "preview_transactions_file",
    description: `Preview a bank file (CSV, TSV, OFX, QFX or QIF, up to 2 MB and 2,000 transactions) for an account, before importing it. The file is sent as content_base64 with its file_name (the extension picks the format). It is stored for 30 days and nothing else is written. Options left out take the values remembered for this account and format, then the defaults; today defaults to the server's UTC day. Returns { file_id, expires_at, file_name, format, labels (CSV header cells), mapping, date_format, date_question (set when the date format is unclear: pass date_format), rows { date, payee_text, memo, amount, fitid, line, key, skip (before_start, before_reconciled, invalid, duplicate_in_file or null), outcome (what an import will do with the row: new, matched (merges a hand-entered row), already_imported (counted matched, nothing written), bank_duplicate (skipped); null for a skipped row) }, skipped_before, row_count, options (the effective ${OPTIONS}) }. ${MONEY} ${dates("date", "today")} ${timestamps(["expires_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id,
      file_name: z.string().min(1).describe("The file's name, with its extension"),
      content_base64: z.string().min(1).describe("The file's bytes, base64"),
      options: FileImportOptions.partial()
        .optional()
        .describe(`Import options; today is a date (YYYY-MM-DD) and may be left out`),
    }),
    run: async (
      input: {
        budget_id: string;
        account_id: string;
        file_name: string;
        content_base64: string;
        options?: Record<string, unknown>;
      },
      { env, actor },
    ) => {
      try {
        return await previewFile(env, actor, {
          budgetId: input.budget_id,
          accountId: input.account_id,
          fileName: input.file_name,
          bytes: decoded(input.content_base64, input.file_name),
          options: input.options,
        });
      } catch (e) {
        throw toolError(e);
      }
    },
  },
  {
    name: "import_transactions_file",
    description: `Import a bank file into an account in one atomic batch. Give a file_id from preview_transactions_file, or file_name with content_base64 (stored first, as a preview does); exactly one of the two. Rows already imported or thrown away are matched, rows entered by hand (same amount, within 10 days) are merged and approved, rows equal to a bank-synced transaction are skipped, and the rest are created cleared and unapproved, with the payee renamed by the account's renaming rules and a category from the payee's default. Run again with the same file it imports nothing. Returns { imported, matched, skipped }. ${OPTIONS}. ${MONEY} ${dates("today")}`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id,
      options: FileImportOptions.describe("Import options; today (YYYY-MM-DD) is required"),
      file_id: Id.optional().describe("From preview_transactions_file"),
      file_name: z.string().min(1).optional(),
      content_base64: z.string().min(1).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        account_id: string;
        options: FileImportOptions;
        file_id?: string;
        file_name?: string;
        content_base64?: string;
      },
      { env, actor },
    ) => {
      const hasContent = input.file_name !== undefined || input.content_base64 !== undefined;
      if ((input.file_id !== undefined) === hasContent) {
        throw new Error(
          "Give either file_id, or file_name with content_base64 (not both, not neither)",
        );
      }
      if (hasContent && (input.file_name === undefined || input.content_base64 === undefined)) {
        throw new Error("file_name and content_base64 go together");
      }
      try {
        return await importFile(env, actor, {
          budgetId: input.budget_id,
          accountId: input.account_id,
          options: input.options,
          fileId: input.file_id,
          file: hasContent
            ? {
                fileName: input.file_name as string,
                bytes: decoded(input.content_base64 as string, input.file_name as string),
              }
            : undefined,
        });
      } catch (e) {
        throw toolError(e);
      }
    },
  },
];
