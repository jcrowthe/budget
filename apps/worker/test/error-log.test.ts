import { env } from "cloudflare:test";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import type { AppEnv, Env } from "../src/env";
import { describeError, onError } from "../src/middleware/errors";
import { cronRun } from "../src/scheduled";
import { seedBigGroup } from "./bound-lists-helpers";
import { api, mcp } from "./category-helpers";
import { brokenDb, captureErrors } from "./error-log-helpers";
import { authed, call, localToken } from "./helpers";

const BODY = '{"error":{"id":"500","name":"internal_error","detail":"Internal error"}}';
const MARKER = "ZZ-MARKER-93";
const noValue = (line: string, ...ids: string[]) => {
  for (const v of [MARKER, "ZZ-QUERY-93", "ZZ-HEADER-93", ...ids]) expect(line).not.toContain(v);
};

const BID = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const testApp = () => {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.post("/api/v1/budgets/:budget_id/zz-error-log", async (c) => {
    const memo = ((await c.req.json()) as { memo: string }).memo;
    await getDb(c.env).all(
      sql`insert into categories (id, name) values (${crypto.randomUUID()}, ${memo})`,
    );
    return c.json({});
  });
  app.get("/api/v1/budgets/:budget_id/zz-error-log/plain", () => {
    throw new Error("boom");
  });
  app.get("/api/v1/budgets/:budget_id/zz-error-log/thrown", () => {
    throw MARKER;
  });
  return app;
};
const post = () =>
  testApp().request(
    `/api/v1/budgets/${BID}/zz-error-log?q=ZZ-QUERY-93`,
    {
      method: "POST",
      headers: { "x-zz": "ZZ-HEADER-93", "content-type": "application/json" },
      body: JSON.stringify({ memo: MARKER }),
    },
    env,
  );

describe("EXF-884: what an unexpected error logs", () => {
  it("E1: a failed statement through the real app", async () => {
    const s = await seedBigGroup(3);
    const lines = captureErrors();
    const res = await call(
      `${api(s.bid, `/category_groups/${s.groupId}/usage`)}?q=ZZ-QUERY-93`,
      await authed({ headers: { "x-zz": "ZZ-HEADER-93" } }),
      { DB: brokenDb("month_categories") },
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(BODY);
    const own = lines.filter((l) => l.startsWith("internal_error"));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain(
      "internal_error GET /api/v1/budgets/:budget_id/category_groups/:group_id/usage | DrizzleQueryError: select (select count(*) from transactions where budget_id = ? and deleted_at is null and category_id in (select value from json_each(?))) as t",
    );
    expect(own[0]).toContain(
      " <- Error: D1_ERROR: no such table: zz_error_log_missing: SQLITE_ERROR",
    );
    noValue(own[0] as string, s.bid, s.groupId, ...s.ids);
  });

  it("E2: the marker in a bound parameter is not logged", async () => {
    const lines = captureErrors();
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(BODY);
    expect(lines).toEqual([
      "internal_error POST /api/v1/budgets/:budget_id/zz-error-log | DrizzleQueryError: insert into categories (id, name) values (?, ?) <- Error: D1_ERROR: NOT NULL constraint failed: categories.budget_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)",
    ]);
    noValue(lines[0] as string, BID);
  });

  it("E3: a plain Error", async () => {
    const lines = captureErrors();
    const res = await testApp().request(`/api/v1/budgets/${BID}/zz-error-log/plain`, {}, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(BODY);
    expect(lines).toEqual([
      "internal_error GET /api/v1/budgets/:budget_id/zz-error-log/plain | Error: boom",
    ]);
  });

  it("E4: a thrown non-error bypasses onError, and is never described by its value", async () => {
    const lines = captureErrors();
    let thrown: unknown;
    try {
      await testApp().request(`/api/v1/budgets/${BID}/zz-error-log/thrown`, {}, env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(MARKER);
    expect(lines.filter((l) => l.startsWith("internal_error"))).toEqual([]);
    expect(describeError(MARKER)).toBe("non-error string");
    expect(describeError({ message: MARKER })).toBe("non-error object");
  });

  it("E5: D1's type error holds no value", async () => {
    let e: unknown;
    try {
      await env.DB.prepare("select ?")
        .bind({ toString: () => MARKER } as never)
        .run();
    } catch (x) {
      e = x;
    }
    const d = describeError(e);
    expect(d.startsWith("Error: D1_TYPE_ERROR: Type 'object' not supported for value …")).toBe(
      true,
    );
    expect(d).not.toContain(MARKER);
  });

  it("E6: the rules", () => {
    expect(describeError(new Error(`Failed query: select ?\nparams: ${MARKER}`))).toBe(
      "Error: Failed query: select ?",
    );
    let chain: Error = new Error("e5");
    for (let i = 4; i >= 0; i--) chain = new Error(`e${i}`, { cause: chain });
    expect(describeError(chain).split(" <- ")).toHaveLength(4);
    expect(describeError(new Error("x".repeat(5000))).length).toBeLessThanOrEqual(900);
    expect(
      describeError(new DrizzleQueryError("select ?, ?, ?, ?", [MARKER], new Error("x"))),
    ).toBe("DrizzleQueryError: select ?×4 <- Error: x");
  });

  it("E7: the scheduled job's line", async () => {
    const lines = captureErrors();
    const noRun = (async () => ({ has_more: false })) as never;
    await cronRun(
      { ...env, DB: brokenDb("scheduled_transactions") } as Env,
      new Date("2031-07-14T03:00:00Z"),
      noRun,
    );
    const own = lines.filter((l) => l.startsWith("scheduler failed"));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/^scheduler failed \| DrizzleQueryError: /);
    expect(own[0]).toContain("no such table: zz_error_log_missing");
    expect(own[0]).not.toContain("2031-07-13");
  });
});

async function rpc(method: string, params: unknown, id: number, over: Partial<Env> = {}) {
  const res = await call(
    "/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Cf-Access-Jwt-Assertion": await localToken(),
        Host: "localhost",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    },
    over,
  );
  const text = await res.text();
  const data =
    text
      .split("\n")
      .find((l) => l.startsWith("data:"))
      ?.slice(5) ?? text;
  return JSON.parse(data).result as { isError?: boolean };
}

describe("EXF-884: the MCP endpoint", () => {
  it("E8: a tool that fails for real is logged", async () => {
    const s = await seedBigGroup(3);
    const lines = captureErrors();
    await rpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const r = await rpc(
      "tools/call",
      { name: "get_category_group_usage", arguments: { budget_id: s.bid, group_id: s.groupId } },
      2,
      { DB: brokenDb("month_categories") },
    );
    expect(r.isError).toBe(true);
    const own = lines.filter((l) => l.startsWith("mcp_tool_error"));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/^mcp_tool_error get_category_group_usage \| DrizzleQueryError: /);
    noValue(own[0] as string, s.bid, s.groupId, ...s.ids);
  });

  it("E9: a refusal is not logged", async () => {
    const s = await seedBigGroup(3, { history: true });
    const lines = captureErrors();
    const r = await mcp("delete_category_group", { budget_id: s.bid, group_id: s.groupId });
    expect(r.isError).toBe(true);
    expect(lines.filter((l) => l.startsWith("mcp_tool_error"))).toEqual([]);
  });
});
