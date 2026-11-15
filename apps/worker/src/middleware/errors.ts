import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

/** Services throw this; onError turns it into the 404 envelope. */
export class NotFound extends Error {
  constructor(what = "Resource") {
    super(`${what} not found`);
    this.name = "NotFound";
  }
}

export function apiError(
  c: Context,
  status: 400 | 403 | 404 | 422 | 500,
  name: string,
  detail: string,
) {
  return c.json({ error: { id: String(status), name, detail } }, status);
}

/** Never logs request data (bodies and headers may hold financial data or tokens). */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof NotFound) return apiError(c, 404, "not_found", err.message);
  if (err instanceof ZodError)
    return apiError(c, 400, "bad_request", err.issues.map((i) => i.message).join("; "));
  if (err instanceof HTTPException) {
    const status =
      err.status === 404 ? 404 : err.status === 403 ? 403 : err.status === 422 ? 422 : 400;
    if (err.status >= 400 && err.status < 500)
      return apiError(c, status, status === 400 ? "bad_request" : "error", err.message);
  }
  console.error("internal_error", err instanceof Error ? err.name : "unknown");
  return apiError(c, 500, "internal_error", "Internal error");
};

export const notFoundApi: NotFoundHandler = (c) =>
  apiError(c, 404, "not_found", "Resource not found");
