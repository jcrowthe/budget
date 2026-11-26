import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { idempotency } from "../src/middleware/idempotency";
import { setAssigned } from "../src/services/months";
import { actor as TESTER } from "./category-helpers";
import { authed, call, json } from "./helpers";
import { NOV } from "./plan-fixtures";
import { setOf, undo } from "./undo-helpers";

const post = async (key: string, body: unknown) =>
  call(
    "/api/v1/budgets",
    await authed({
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );

describe("idempotency", () => {
  it("replays the same response for the same key and body", async () => {
    const a = await post("k1", { name: "ZZ-TEST idem" });
    const b = await post("k1", { name: "ZZ-TEST idem" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    expect(a.headers.get("Idempotent-Replayed")).toBeNull();
    const ida = (await a.json()) as { data: { budget: { id: string } } };
    const idb = (await b.json()) as { data: { budget: { id: string } } };
    expect(idb.data.budget.id).toBe(ida.data.budget.id);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM budgets WHERE name = 'ZZ-TEST idem'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
  it("rejects the same key with a different body", async () => {
    await post("k2", { name: "ZZ-TEST one" });
    const res = await post("k2", { name: "ZZ-TEST two" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { name: string } }).error.name).toBe(
      "idempotency_key_reused",
    );
  });
  it("treats rows older than 24 h as absent", async () => {
    await post("k3", { name: "ZZ-TEST old" });
    await env.DB.prepare(
      "UPDATE idempotency_keys SET created_at = '2000-01-01T00:00:00.000Z' WHERE key = 'k3'",
    ).run();
    const res = await post("k3", { name: "ZZ-TEST old again" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
  });
});

describe("idempotent replay keeps its change set", () => {
  it("replays Budget-Change-Set, and Undo works on it after a retry", async () => {
    const make = await post("cs1", { name: "ZZ-TEST cs1" });
    const bid = ((await make.json()) as { data: { budget: { id: string } } }).data.budget.id;
    const cats = (await (await json(`/api/v1/budgets/${bid}/months/${NOV}`)).json()) as {
      data: { groups: { categories: { id: string }[] }[] };
    };
    const ids = cats.data.groups.flatMap((g) => g.categories.map((c) => c.id));
    await setAssigned(env, TESTER, {
      budget_id: bid,
      month: NOV,
      category_id: ids[0] as string,
      assigned: 100000,
    });
    const req = async () =>
      call(
        `/api/v1/budgets/${bid}/months/${NOV}/moves`,
        await authed({
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "cs1-move" },
          body: JSON.stringify({ from: ids[0], to: ids[1], amount: 40000 }),
        }),
      );
    const a = await req();
    const b = await req();
    expect(a.status).toBeLessThan(300);
    expect(b.status).toBe(a.status);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    expect(setOf(b)).toBe(setOf(a));
    const u = await undo(bid, setOf(b));
    expect(u.status).toBe(200);
  });
});

describe("replay of a write with no change set", () => {
  it("carries no Budget-Change-Set header", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("identity", { kind: "user", actor: "user:nocs@example.test" });
      return next();
    });
    app.use("/api/v1/*", idempotency());
    app.post("/api/v1/thing", (c) => c.json({ data: { ok: true } }, 201));
    const send = () =>
      app.request(
        "/api/v1/thing",
        { method: "POST", headers: { "Idempotency-Key": "nocs1" }, body: "{}" },
        env,
      );
    expect((await send()).headers.get("Budget-Change-Set")).toBeNull();
    const b = await send();
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    expect(b.headers.get("Budget-Change-Set")).toBeNull();
  });
});

describe("idempotency under concurrency", () => {
  it("two concurrent same-key POSTs create exactly one plan", async () => {
    const [a, b] = await Promise.all([
      post("race1", { name: "ZZ-TEST race1" }),
      post("race1", { name: "ZZ-TEST race1" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM budgets WHERE name = 'ZZ-TEST race1'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

type Hooks = { beforeSelect?: () => Promise<void>; beforeInsert?: () => Promise<void> };

/** Wraps D1 so the idempotency_keys SELECT and INSERT statements await a hook before they run. */
function hookD1(real: D1Database, hooks: Hooks): D1Database {
  const wrapBound = (bound: D1PreparedStatement, hook: () => Promise<void>) =>
    new Proxy(bound, {
      get(t, p) {
        if (p === "run" || p === "all" || p === "raw" || p === "first") {
          return async (...args: unknown[]) => {
            await hook();
            return Reflect.apply(Reflect.get(t, p, t) as () => unknown, t, args);
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  return new Proxy(real, {
    get(t, p) {
      if (p === "prepare") {
        return (sql: string) => {
          const stmt = t.prepare(sql);
          const q = sql.toLowerCase().trimStart();
          const hook = q.startsWith("select")
            ? hooks.beforeSelect
            : q.startsWith("insert into")
              ? hooks.beforeInsert
              : undefined;
          if (!hook || !q.includes("idempotency_keys")) return stmt;
          return new Proxy(stmt, {
            get(st, sp) {
              if (sp === "bind") {
                return (...args: unknown[]) => wrapBound(st.bind(...args), hook);
              }
              const v = Reflect.get(st, sp, st);
              return typeof v === "function" ? v.bind(st) : v;
            },
          });
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

describe("idempotency reservation retry", () => {
  const ACTOR = "user:retry@example.test";
  let calls = 0;
  const app = new Hono<AppEnv>();
  app.use("*", (c, next) => {
    c.set("identity", { kind: "user", actor: ACTOR });
    return next();
  });
  app.use("/api/v1/*", idempotency());
  app.post("/api/v1/thing", (c) => {
    calls++;
    return c.json({ data: { ok: true } }, 201);
  });

  const send = (key: string, hooks: Hooks) =>
    app.request(
      "/api/v1/thing",
      {
        method: "POST",
        headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
        body: "{}",
      },
      { ...env, DB: hookD1(env.DB, hooks) },
    );
  const seed = (key: string) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO idempotency_keys (actor, key, method, path, request_hash, status, response_body, created_at) VALUES (?, ?, 'POST', '/api/v1/thing', 'other', 0, '', ?)",
    )
      .bind(ACTOR, key, new Date().toISOString())
      .run();
  const unseed = (key: string) =>
    env.DB.prepare("DELETE FROM idempotency_keys WHERE actor = ? AND key = ?")
      .bind(ACTOR, key)
      .run();

  it("retries when the reserved row vanishes before it is read", async () => {
    calls = 0;
    await seed("retry1");
    let selects = 0;
    const res = await send("retry1", {
      beforeSelect: async () => {
        if (++selects === 1) await unseed("retry1");
      },
    });
    expect(res.status).toBe(201);
    expect(calls).toBe(1);
    expect(selects).toBe(1);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    const row = await env.DB.prepare(
      "SELECT status FROM idempotency_keys WHERE actor = ? AND key = 'retry1'",
    )
      .bind(ACTOR)
      .first<{ status: number }>();
    expect(row?.status).toBe(201);
  });

  it("answers 409 when the row vanishes on every attempt", async () => {
    calls = 0;
    let inserts = 0;
    let selects = 0;
    const res = await send("retry2", {
      beforeInsert: async () => {
        inserts++;
        await seed("retry2");
      },
      beforeSelect: async () => {
        selects++;
        await unseed("retry2");
      },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { name: string } }).error.name).toBe(
      "idempotency_key_in_progress",
    );
    expect(calls).toBe(0);
    expect(inserts).toBe(3);
    expect(selects).toBe(3);
  });
});
