import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { runInChangeSet } from "../history/change-set";

export const BUDGET_CHANGE_SET_HEADER = "Budget-Change-Set";
const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Opens a change set for a write request: every change_log row written while the rest of the chain runs carries
 * the id, and a 2xx response names it in `Budget-Change-Set`. Makes no D1 call. A replayed idempotent response
 * keeps the header of the original response (idempotency.ts stores and replays it).
 */
export function changeSet() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!WRITES.has(c.req.method)) return next();
    const id = crypto.randomUUID();
    await runInChangeSet(id, () => next());
    if (c.res.status < 200 || c.res.status > 299) return;
    if (c.res.headers.get("Idempotent-Replayed") === "true") return;
    try {
      c.res.headers.set(BUDGET_CHANGE_SET_HEADER, id);
    } catch {
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set(BUDGET_CHANGE_SET_HEADER, id);
    }
  });
}
