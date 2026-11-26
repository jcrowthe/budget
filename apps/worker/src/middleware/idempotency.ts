import { and, eq, lt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client";
import { idempotencyKeys } from "../db/schema/idempotency-keys";
import type { AppEnv } from "../env";
import { currentChangeSetId } from "../history/change-set";
import { apiError } from "./errors";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const TTL_MS = 24 * 60 * 60 * 1000;
/** status 0 marks a reservation whose handler has not finished yet. */
const PENDING = 0;

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Replays the stored response for a repeated Idempotency-Key (per actor, 24 h).
 * The key is reserved with one conditional INSERT before the handler runs, so two concurrent requests
 * with the same key cannot both execute.
 */
export function idempotency() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (!key || !WRITE_METHODS.has(c.req.method)) return next();
    const actor = c.get("identity").actor;
    const path = new URL(c.req.url).pathname;
    const body = await c.req.raw.clone().arrayBuffer();
    const hash = await sha256Hex(`${c.req.method}\n${path}\n${await sha256Hex(body)}`);
    const db = getDb(c.env);
    const now = new Date();
    const reservation = {
      actor,
      key,
      method: c.req.method,
      path,
      requestHash: hash,
      status: PENDING,
      responseBody: "",
      createdAt: now.toISOString(),
    };

    // Insert, or take over an expired row, in a single statement. The handler runs only if THIS request's
    // own write created or took over the row. If the row vanished between our insert and our read (its
    // owner failed and released it), try again; never fall through without a reservation.
    let reserved = false;
    for (let attempt = 0; attempt < 3 && !reserved; attempt++) {
      const res = await db
        .insert(idempotencyKeys)
        .values(reservation)
        .onConflictDoUpdate({
          target: [idempotencyKeys.actor, idempotencyKeys.key],
          set: reservation,
          setWhere: lt(idempotencyKeys.createdAt, new Date(now.getTime() - TTL_MS).toISOString()),
        })
        .run();
      if (res.meta.changes > 0) {
        reserved = true;
        break;
      }
      const [row] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)))
        .limit(1);
      if (!row) continue;
      if (row.requestHash !== hash) {
        return apiError(
          c,
          422,
          "idempotency_key_reused",
          "Idempotency-Key was used with a different request",
        );
      }
      if (row.status === PENDING) {
        return apiError(
          c,
          409,
          "idempotency_key_in_progress",
          "A request with this Idempotency-Key is still running",
        );
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotent-Replayed": "true",
      };
      // The replay owns no rows, but Undo needs the original change set's id.
      if (row.changeSetId && row.status >= 200 && row.status <= 299) {
        headers["Budget-Change-Set"] = row.changeSetId;
      }
      return new Response(row.responseBody, { status: row.status, headers });
    }
    if (!reserved) {
      return apiError(
        c,
        409,
        "idempotency_key_in_progress",
        "A request with this Idempotency-Key is still running",
      );
    }

    const mine = and(
      eq(idempotencyKeys.actor, actor),
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.requestHash, hash),
      eq(idempotencyKeys.status, PENDING),
    );
    try {
      await next();
    } catch (e) {
      await db.delete(idempotencyKeys).where(mine);
      throw e;
    }
    if (c.res.status < 500) {
      await db
        .update(idempotencyKeys)
        .set({
          status: c.res.status,
          responseBody: await c.res.clone().text(),
          changeSetId: currentChangeSetId(),
        })
        .where(mine);
    } else {
      await db.delete(idempotencyKeys).where(mine);
    }
  });
}
