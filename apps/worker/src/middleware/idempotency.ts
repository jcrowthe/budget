import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client";
import { idempotencyKeys } from "../db/schema/idempotency-keys";
import type { AppEnv } from "../env";
import { apiError } from "./errors";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const TTL_MS = 24 * 60 * 60 * 1000;

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Replays the stored response for a repeated Idempotency-Key (per actor, 24 h). */
export function idempotency() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (!key || !WRITE_METHODS.has(c.req.method)) return next();
    const actor = c.get("identity").actor;
    const path = new URL(c.req.url).pathname;
    const body = await c.req.raw.clone().arrayBuffer();
    const hash = await sha256Hex(`${c.req.method}\n${path}\n${await sha256Hex(body)}`);
    const db = getDb(c.env);
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)))
      .limit(1);
    const fresh = row && Date.now() - Date.parse(row.createdAt) < TTL_MS;
    if (row && fresh) {
      if (row.requestHash !== hash) {
        return apiError(
          c,
          422,
          "idempotency_key_reused",
          "Idempotency-Key was used with a different request",
        );
      }
      return new Response(row.responseBody, {
        status: row.status,
        headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
      });
    }
    await next();
    if (c.res.status < 500) {
      const text = await c.res.clone().text();
      const values = {
        actor,
        key,
        method: c.req.method,
        path,
        requestHash: hash,
        status: c.res.status,
        responseBody: text,
        createdAt: new Date().toISOString(),
      };
      if (row) {
        await db
          .delete(idempotencyKeys)
          .where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)));
      }
      await db.insert(idempotencyKeys).values(values).onConflictDoNothing();
    }
  });
}
