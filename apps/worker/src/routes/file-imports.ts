import { ErrorBody } from "@budget/schema/common/envelope";
import {
  type FileImportOptions,
  FileImportPreviewResponse,
  FileImportRequest,
  FileImportResultResponse,
  MAX_FILE_BYTES,
} from "@budget/schema/file-import";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { FileImportRefused, importFile, previewFile } from "../services/file-import";

const tags = ["Accounts"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const params = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  account_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "account_id", in: "path" } }),
});
const errors = {
  404: json(ErrorBody, "Plan, account or file not found"),
  410: json(ErrorBody, "The file is no longer stored (file_expired)"),
  413: json(ErrorBody, "The file is larger than 2 MB (file_too_large)"),
  422: json(
    ErrorBody,
    "Unreadable file, too many rows, an unclear date format, a closed account or bad options",
  ),
};

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        422,
        "unprocessable_entity",
        result.error.issues.map((i) => i.message).join("; "),
      );
    }
  },
});

/** `apiError` knows no 410 or 413, so those two are written here in the same body shape. */
function refuse(c: Context<AppEnv>, e: unknown) {
  if (e instanceof FileImportRefused) {
    if (e.status === 410 || e.status === 413) {
      return c.json({ error: { id: String(e.status), name: e.code, detail: e.message } }, e.status);
    }
    return apiError(c, e.status, e.code, e.message);
  }
  throw e;
}

const uploadBody = z.object({
  file: z.custom<File>().openapi({
    type: "string",
    format: "binary",
    description: "The bank file: .csv, .tsv, .ofx, .qfx or .qif, up to 2 MB",
  }),
  options: z.string().optional().openapi({
    description:
      "JSON of the import options (no_header, mapping, date_format, swap_inflow_outflow, import_memos, swap_payee_memo, include_before_start, remember, today). A field left out takes the value remembered for this account and format, then the default; today defaults to the server's UTC day.",
  }),
});

app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/{budget_id}/accounts/{account_id}/imports/preview",
    tags,
    summary: "Preview a bank file for an account (File Import step 1)",
    description:
      "Reads the file against the account and stores it for 30 days. Nothing else is written. Returns the file_id, the effective options, the detected format, labels, mapping and date format, and each row with its import key and skip reason.",
    request: {
      params,
      body: { required: true, content: { "multipart/form-data": { schema: uploadBody } } },
    },
    responses: {
      200: json(FileImportPreviewResponse, "The preview"),
      404: errors[404],
      413: errors[413],
      422: errors[422],
    },
  }),
  async (c) => {
    try {
      const { budget_id, account_id } = c.req.valid("param");
      const form = await c.req.parseBody({ all: true });
      const part = form.file;
      if (!(part instanceof File)) {
        throw new FileImportRefused(
          422,
          "unprocessable_entity",
          "Send the bank file as one `file` part",
        );
      }
      if (part.size > MAX_FILE_BYTES) {
        throw new FileImportRefused(413, "file_too_large", "The file is larger than 2 MB");
      }
      let options: Record<string, unknown> | undefined;
      const text = form.options;
      if (typeof text === "string" && text !== "") {
        try {
          const parsed = JSON.parse(text);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
          options = parsed as Record<string, unknown>;
        } catch {
          throw new FileImportRefused(422, "unprocessable_entity", "options must be a JSON object");
        }
      }
      const data = await previewFile(c.env, c.get("identity").actor, {
        budgetId: budget_id,
        accountId: account_id,
        fileName: part.name,
        bytes: new Uint8Array(await part.arrayBuffer()),
        options,
      });
      return c.json({ data }, 200);
    } catch (e) {
      return refuse(c, e) as never;
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/{budget_id}/accounts/{account_id}/imports",
    tags,
    summary: "Import a previewed bank file (File Import step 2)",
    description:
      "Re-reads the stored file (rows sent by a client are never trusted) and writes it in one atomic batch: rows already imported or thrown away are matched, rows entered by hand are merged, rows equal to a bank-synced one are skipped, the rest are created cleared and unapproved with their payee renamed by the rules and a category from the payee's default. Returns { imported, matched, skipped }.",
    request: {
      params,
      body: { required: true, content: { "application/json": { schema: FileImportRequest } } },
    },
    responses: {
      200: json(FileImportResultResponse, "The counts"),
      404: errors[404],
      410: errors[410],
      413: errors[413],
      422: errors[422],
    },
  }),
  async (c) => {
    try {
      const { budget_id, account_id } = c.req.valid("param");
      const { file_id, options } = c.req.valid("json");
      const data = await importFile(c.env, c.get("identity").actor, {
        budgetId: budget_id,
        accountId: account_id,
        fileId: file_id,
        options: options as FileImportOptions,
      });
      return c.json({ data }, 200);
    } catch (e) {
      return refuse(c, e) as never;
    }
  },
);

export default app;
