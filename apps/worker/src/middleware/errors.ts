import { DrizzleError, DrizzleQueryError } from "drizzle-orm";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { ZodError } from "zod";

/** The row changed between the read and the write; the client may retry. */
export class Conflict extends Error {
  constructor(what = "Resource") {
    super(`${what} was modified concurrently`);
    this.name = "Conflict";
  }
}

/** Services throw this; onError turns it into the 404 envelope. */
export class NotFound extends Error {
  constructor(what = "Resource") {
    super(`${what} not found`);
    this.name = "NotFound";
  }
}

export function apiError(
  c: Context,
  status: 400 | 403 | 404 | 409 | 422 | 500,
  name: string,
  detail: string,
) {
  return c.json({ error: { id: String(status), name, detail } }, status);
}

/** The longest line an error log writes. */
export const LOG_LINE_MAX = 1000;
const MAX_LINKS = 4;
const MAX_TEXT = 300;
const MAX_DESCRIPTION = 900;

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** The text of one link of a cause chain, with no bound value in it. */
function textOf(e: unknown): string {
  if (e instanceof DrizzleQueryError) {
    // `message` and `params` hold the bound values; the statement's own text holds placeholders only.
    const q = typeof e.query === "string" ? e.query : "";
    return squash(q.replace(/\?(?:\s*,\s*\?){2,}/g, (m) => `?×${m.split("?").length - 1}`)).slice(
      0,
      MAX_TEXT,
    );
  }
  if (!(e instanceof Error)) return "";
  const m = String(e.message)
    .split("\nparams:")[0]
    ?.replace(/for value[\s\S]*$/, "for value …");
  return squash(m ?? "").slice(0, MAX_TEXT);
}

/**
 * For the log: names and messages down the cause chain (at most 4 links), never a bound value. A thrown
 * non-error is named by its type only. Never put a value in a thrown Error's message: it is logged on a 500.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let prevText = "";
  let cur: unknown = err;
  for (let i = 0; i < MAX_LINKS && cur !== null && cur !== undefined && !seen.has(cur); i++) {
    seen.add(cur);
    const label =
      cur instanceof DrizzleQueryError
        ? "DrizzleQueryError"
        : cur instanceof Error
          ? String(cur.name).slice(0, 40)
          : `non-error ${typeof cur}`;
    const text = textOf(cur);
    if (!(text && prevText.includes(text))) {
      parts.push(text ? `${label}: ${text}` : label);
      prevText = text || prevText;
    }
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.join(" <- ").slice(0, MAX_DESCRIPTION);
}

function isFault(e: unknown): boolean {
  const seen = new Set<unknown>();
  for (let cur = e, i = 0; cur !== null && cur !== undefined && !seen.has(cur) && i < 8; i++) {
    seen.add(cur);
    if (!(cur instanceof Error)) return i === 0;
    if (cur instanceof DrizzleQueryError || cur instanceof DrizzleError) return true;
    if (String(cur.message).startsWith("D1_")) return true;
    if (i === 0 && ["TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(cur.name))
      return true;
    cur = cur.cause;
  }
  return false;
}

/** MCP: logs `mcp_tool_error <tool> | <describeError(e)>` only for a fault; a refusal is not logged. */
export function logToolError(tool: string, e: unknown): void {
  if (isFault(e))
    console.error(`mcp_tool_error ${tool} | ${describeError(e)}`.slice(0, LOG_LINE_MAX));
}

/**
 * For an unexpected error it logs the method, the route's pattern and `describeError`: never the address, a
 * query string, a header or a body (they may hold financial data or tokens).
 */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof NotFound) return apiError(c, 404, "not_found", err.message);
  if (err instanceof Conflict) return apiError(c, 409, "conflict", err.message);
  if (err instanceof ZodError)
    return apiError(c, 400, "bad_request", err.issues.map((i) => i.message).join("; "));
  if (err instanceof HTTPException) {
    const status =
      err.status === 404 ? 404 : err.status === 403 ? 403 : err.status === 422 ? 422 : 400;
    if (err.status >= 400 && err.status < 500)
      return apiError(c, status, status === 400 ? "bad_request" : "error", err.message);
  }
  const route = routePath(c);
  console.error(
    `internal_error ${c.req.method}${route ? ` ${route}` : ""} | ${describeError(err)}`.slice(
      0,
      LOG_LINE_MAX,
    ),
  );
  return apiError(c, 500, "internal_error", "Internal error");
};

export const notFoundApi: NotFoundHandler = (c) =>
  apiError(c, 404, "not_found", "Resource not found");
