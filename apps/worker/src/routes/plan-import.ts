import { ErrorBody } from "@budget/schema/common/envelope";
import {
  PlanImportCancelResponse,
  PlanImportOptions,
  PlanImportPreviewResponse,
  PlanImportResultResponse,
} from "@budget/schema/plan-import";
import { ImportError } from "@budget/schema/plan-import-read";
import { ZipError } from "@budget/schema/zip";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { cancelImport, continueImport, ImportRefused, startImport } from "../services/plan-import";

const tags = ["Plans"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const importParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "import_id", in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Import not found"),
  409: json(ErrorBody, "The import was cancelled, expired or has finished"),
  422: json(ErrorBody, "The file cannot be read as a plan export"),
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

/** Maps what the service throws on a bad file or a step that cannot go on to the API's errors. */
function refuse(c: Parameters<typeof apiError>[0], e: unknown) {
  if (e instanceof ImportRefused) return apiError(c, e.status, e.code, e.message);
  if (e instanceof ZipError) return apiError(c, 422, "unprocessable_entity", e.message);
  if (e instanceof ImportError) {
    return apiError(
      c,
      422,
      e.code === "date_format_unclear" ? "date_format_unclear" : "unprocessable_entity",
      e.message,
    );
  }
  throw e;
}

const uploadBody = z.object({
  file: z.custom<File | File[]>().openapi({
    type: "string",
    format: "binary",
    description: "The export ZIP, or the Plan and Register files (give `file` twice)",
  }),
  name: z
    .string()
    .optional()
    .openapi({ description: "The new plan's name (default: from the file name)" }),
  export_date: z
    .string()
    .optional()
    .openapi({ description: "YYYY-MM-DD; rows dated after it become scheduled" }),
  date_format: z.string().optional().openapi({
    description:
      "One of MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY, YYYY.MM.DD",
  }),
  currency_format: z.string().optional().openapi({
    description: "JSON: { currency_symbol, symbol_placement, decimal_separator, decimal_digits }",
  }),
  account_types: z
    .string()
    .optional()
    .openapi({ description: 'JSON: { "<account name>": "<type>" }' }),
});

function jsonField(value: unknown, field: string): unknown {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new ImportError("bad_option", `${field} must be JSON text`);
  try {
    return JSON.parse(value);
  } catch {
    throw new ImportError("bad_option", `${field} is not valid JSON`);
  }
}

app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/import",
    tags,
    summary: "Create a new plan from an Export Plan ZIP (or its Plan and Register files)",
    description:
      "Creates a NEW plan; an existing plan is never changed. dry_run=true writes nothing and returns the preview. A small file answers 201 { import_id, state: done, budget_id, summary }; a large one answers 202 with state writing and no budget_id: call POST /budgets/import/{import_id}/continue until it answers 201.",
    request: {
      query: z.object({ dry_run: z.enum(["true", "false"]).optional() }),
      body: { required: true, content: { "multipart/form-data": { schema: uploadBody } } },
    },
    responses: {
      200: json(PlanImportPreviewResponse, "The preview (dry_run): nothing was written"),
      201: json(PlanImportResultResponse, "The plan was created"),
      202: json(PlanImportResultResponse, "Writing: call continue"),
      403: errors[403],
      422: errors[422],
    },
  }),
  async (c) => {
    try {
      const form = await c.req.parseBody({ all: true });
      const raw = form.file;
      const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) as unknown[];
      if (list.length < 1 || list.length > 2 || !list.every((f) => f instanceof File)) {
        throw new ImportError(
          "not_recognized",
          "Send the export ZIP as one `file`, or the Plan and Register files as two",
        );
      }
      const files = await Promise.all(
        (list as File[]).map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      const str = (k: string) =>
        typeof form[k] === "string" && form[k] !== "" ? (form[k] as string) : undefined;
      const parsed = PlanImportOptions.safeParse({
        name: str("name"),
        export_date: str("export_date"),
        date_format: str("date_format"),
        currency_format: jsonField(form.currency_format, "currency_format"),
        account_types: jsonField(form.account_types, "account_types"),
      });
      if (!parsed.success) {
        throw new ImportError(
          "bad_option",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }
      const out = await startImport(c.env, c.get("identity").actor, {
        files,
        options: parsed.data,
        dryRun: c.req.valid("query").dry_run === "true",
      });
      if (out.status === 200) return c.json({ data: out.preview }, 200);
      return c.json({ data: out.result }, out.status);
    } catch (e) {
      return refuse(c, e) as never;
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/import/{import_id}/continue",
    tags,
    summary: "Write the next step of an import",
    description:
      "Repeating a step, or calling it twice at once, writes nothing twice. Answers 202 until the last step, then 201 with the budget_id; on a finished import it answers the same 201 again.",
    request: { params: z.object({ import_id: importParam }) },
    responses: {
      201: json(PlanImportResultResponse, "The plan was created"),
      202: json(PlanImportResultResponse, "More steps to go"),
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
    },
  }),
  async (c) => {
    try {
      const out = await continueImport(c.env, c.req.valid("param").import_id);
      return c.json({ data: out.result }, out.status);
    } catch (e) {
      return refuse(c, e) as never;
    }
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/budgets/import/{import_id}",
    tags,
    summary: "Cancel an unfinished import and remove everything it wrote",
    request: { params: z.object({ import_id: importParam }) },
    responses: {
      200: json(PlanImportCancelResponse, "The import was cancelled"),
      403: errors[403],
      404: errors[404],
      409: errors[409],
    },
  }),
  async (c) => {
    try {
      return c.json({ data: await cancelImport(c.env, c.req.valid("param").import_id) }, 200);
    } catch (e) {
      return refuse(c, e) as never;
    }
  },
);

export default app;
