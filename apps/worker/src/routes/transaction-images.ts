import { ErrorBody } from "@budget/schema/common/envelope";
import {
  DeleteTransactionImageResponse,
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  TransactionImageResponse,
} from "@budget/schema/transaction-images";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  attachTransactionImage,
  deleteTransactionImage,
  getTransactionImage,
  ImageRefused,
} from "../services/transaction-images";

const tags = ["Transactions"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const params = z.object({ budget_id: param("budget_id"), transaction_id: param("transaction_id") });
const errors = {
  404: json(
    ErrorBody,
    "Plan, transaction (a split line or a deleted one counts as missing) or image not found",
  ),
};

/** Multipart framing around the file: the body limit is the image limit plus this. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** `apiError` knows no 413 or 415, so those are written here in the same body shape. */
function refuse(c: Context<AppEnv>, e: unknown) {
  if (e instanceof ImageRefused) {
    if (e.status === 413 || e.status === 415) {
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
    description: `The image: ${IMAGE_ACCEPT}, up to 10 MB. The bytes must match the declared type.`,
  }),
});

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replaceAll('"', "'");

const app = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/transactions/{transaction_id}/image",
      tags,
      summary: "Attach (or replace) the transaction's image",
      description:
        "Multipart with one `file` part: a JPEG, PNG, WebP, AVIF, GIF or SVG of at most 10 MB. A second PUT replaces the image. Returns { transaction_id, content_type, byte_size, file_name, created_at }. Not undoable.",
      request: {
        params,
        body: { required: true, content: { "multipart/form-data": { schema: uploadBody } } },
      },
      responses: {
        200: json(TransactionImageResponse, "The attached image"),
        404: errors[404],
        413: json(ErrorBody, "The image is larger than 10 MB (file_too_large)"),
        415: json(
          ErrorBody,
          "Not one of the six image types, or the bytes do not match (unsupported_media_type)",
        ),
        422: json(ErrorBody, "No `file` part, or an empty file"),
      },
    }),
    async (c) => {
      try {
        const { budget_id, transaction_id } = c.req.valid("param");
        const length = Number(c.req.header("content-length") ?? 0);
        if (length > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD) {
          throw new ImageRefused(413, "file_too_large", "The image is larger than 10 MB");
        }
        const form = await c.req.parseBody({ all: true });
        const part = form.file;
        if (!(part instanceof File)) {
          throw new ImageRefused(422, "unprocessable_entity", "Send the image as one `file` part");
        }
        if (part.size > MAX_IMAGE_BYTES) {
          throw new ImageRefused(413, "file_too_large", "The image is larger than 10 MB");
        }
        const data = await attachTransactionImage(c.env, c.get("identity").actor, {
          budgetId: budget_id,
          transactionId: transaction_id,
          bytes: new Uint8Array(await part.arrayBuffer()),
          contentType: part.type,
          fileName: part.name ? part.name.slice(0, 200) : null,
        });
        return c.json({ data }, 200);
      } catch (e) {
        return refuse(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/transactions/{transaction_id}/image",
      tags,
      summary: "Stream the transaction's image",
      description:
        "The image bytes with their content type, an ETag (304 for a matching If-None-Match) and headers that keep an SVG from running script.",
      request: { params },
      responses: {
        200: {
          description: "The image",
          content: Object.fromEntries(
            IMAGE_ACCEPT.split(",").map((t) => [
              t,
              { schema: z.string().openapi({ format: "binary" }) },
            ]),
          ),
        },
        304: { description: "Not modified" },
        404: errors[404],
      },
    }),
    async (c) => {
      const { budget_id, transaction_id } = c.req.valid("param");
      const r = await getTransactionImage(c.env, {
        budgetId: budget_id,
        transactionId: transaction_id,
        ifNoneMatch: c.req.header("if-none-match"),
      });
      if (r === "not_modified") return c.body(null, 304) as never;
      const name = asciiName(r.fileName ?? "image");
      return new Response(r.body, {
        status: 200,
        headers: {
          "Content-Type": r.contentType,
          "Content-Length": String(r.size),
          ETag: r.etag,
          "Cache-Control": "private, no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(r.fileName ?? "image")}`,
        },
      }) as never;
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/transactions/{transaction_id}/image",
      tags,
      summary: "Delete the transaction's image",
      description: "Returns { transaction_id, deleted: true }. Not undoable.",
      request: { params },
      responses: {
        200: json(DeleteTransactionImageResponse, "Deleted"),
        404: errors[404],
      },
    }),
    async (c) => {
      const { budget_id, transaction_id } = c.req.valid("param");
      const data = await deleteTransactionImage(c.env, c.get("identity").actor, {
        budgetId: budget_id,
        transactionId: transaction_id,
      });
      return c.json({ data }, 200);
    },
  );

export default app;
