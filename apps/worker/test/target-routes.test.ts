import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;
const actor = "user:tester@localhost";
const MONTHLY = { cadence: "monthly", behavior: "set_aside", amount: 100000 };

async function seed() {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
  const group = await createCategoryGroup(env, actor, { budget_id: bid, name: "Bills" });
  const cid = (
    await createCategory(env, actor, { budget_id: bid, group_id: group.id, name: "Rent" })
  ).id;
  return { bid, cid, path: `/api/v1/budgets/${bid}/categories/${cid}/target` };
}
const put = (path: string, body: unknown, today?: string) =>
  json(`${path}${today ? `?today=${today}` : ""}`, { method: "PUT" }, body);
async function mcp(name: string, args: Record<string, unknown>): Promise<Json> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result;
}
const structured = (r: Json): Json => JSON.parse(r.content[0].text);
async function category(bid: string, month: string, cid: string, today?: string) {
  const res = await json(`/api/v1/budgets/${bid}/months/${month}${today ? `?today=${today}` : ""}`);
  expect(res.status).toBe(200);
  const d = ((await res.json()) as Json).data;
  return d.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.id === cid);
}
const logs = async (cid: string) =>
  (
    await env.DB.prepare(
      "SELECT actor, action FROM change_log WHERE entity_type = 'target' AND entity_id = ? ORDER BY created_at, rowid",
    )
      .bind(cid)
      .all<{ actor: string; action: string }>()
  ).results;

describe("target routes and tools", () => {
  it("lists the path and both tools", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/categories/{category_id}/target",
    );
    const tools = await listedToolNames();
    expect(tools).toContain("set_category_target");
    expect(tools).toContain("delete_category_target");
  });

  it("PUT creates, replaces keeping created_on, DELETE returns the old target", async () => {
    const { path, cid } = await seed();
    const a = await put(path, MONTHLY, "2026-11-02");
    expect(a.status).toBe(200);
    const created = ((await a.json()) as Json).data.target;
    expect(created).toMatchObject({ created_month: "2026-11-01", created_on: "2026-11-02" });
    const b = await put(path, { ...MONTHLY, amount: 2000 }, "2026-12-20");
    expect(((await b.json()) as Json).data.target).toMatchObject({
      amount: 2000,
      created_on: "2026-11-02",
    });
    const d = await json(path, { method: "DELETE" });
    expect(d.status).toBe(200);
    expect(((await d.json()) as Json).data.deleted).toMatchObject({ amount: 2000 });
    expect((await json(path, { method: "DELETE" })).status).toBe(404);
    expect((await logs(cid)).map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect((await logs(cid)).every((r) => r.actor === actor)).toBe(true);
  });

  it("refuses each invalid combination with 422 and a readable detail", async () => {
    const { path } = await seed();
    const bad: unknown[] = [
      { ...MONTHLY, amount: 0 },
      { cadence: "weekly", behavior: "fill_up", amount: 1000, day_of_week: 1 },
      { cadence: "weekly", behavior: "set_aside", amount: 1000 },
      { ...MONTHLY, due_date: "2027-01-01" },
      { cadence: "yearly", behavior: "set_aside", amount: 1000 },
      { cadence: "custom", behavior: "refill", amount: 1000 },
      { cadence: "custom", behavior: "balance", amount: 1000, due_date: "2027-01-01" },
      { cadence: "custom", behavior: "set_aside", amount: 1000 },
      { cadence: "weekly", behavior: "set_aside", amount: 1000, day_of_week: 7 },
    ];
    for (const body of bad) {
      const res = await put(path, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(((await res.json()) as Json).error.detail.length).toBeGreaterThan(5);
    }
    expect((await put(path, MONTHLY, "2026-02-30")).status).toBe(422);
  });

  it("404 for unknown plan and category", async () => {
    const { bid } = await seed();
    const other = crypto.randomUUID();
    expect((await put(`/api/v1/budgets/${bid}/categories/${other}/target`, MONTHLY)).status).toBe(
      404,
    );
    expect((await put(`/api/v1/budgets/${other}/categories/${other}/target`, MONTHLY)).status).toBe(
      404,
    );
    expect((await put(`/api/v1/budgets/x/categories/y/target`, MONTHLY)).status).toBe(404);
  });

  it("the tools create and delete with an mcp actor, and the read equals REST", async () => {
    const { bid, cid } = await seed();
    const set = await mcp("set_category_target", {
      budget_id: bid,
      category_id: cid,
      ...MONTHLY,
      day_of_month: 10,
      today: "2026-11-15",
    });
    expect(structured(set).target).toMatchObject({ created_month: "2026-11-01", day_of_month: 10 });
    const viaMcp = structured(
      await mcp("get_plan_month", { budget_id: bid, month: "2026-11-01", today: "2026-11-15" }),
    );
    const viaRest = (
      (await (
        await json(`/api/v1/budgets/${bid}/months/2026-11-01?today=2026-11-15`)
      ).json()) as Json
    ).data;
    expect(viaMcp).toEqual(viaRest);
    const del = await mcp("delete_category_target", { budget_id: bid, category_id: cid });
    expect(structured(del).deleted).toMatchObject({ amount: 100000 });
    const rows = await logs(cid);
    expect(rows.map((r) => r.action)).toEqual(["create", "delete"]);
    expect(rows.every((r) => r.actor === `mcp:${actor}`)).toBe(true);
    const bad = await mcp("set_category_target", {
      budget_id: bid,
      category_id: cid,
      cadence: "yearly",
      behavior: "set_aside",
      amount: 1000,
    });
    expect(bad.isError).toBe(true);
  });

  it("the owner's date decides on the last evening of a month", async () => {
    const { bid, cid, path } = await seed();
    const res = await put(path, MONTHLY, "2026-11-30");
    expect(((await res.json()) as Json).data.target.created_month).toBe("2026-11-01");
    expect((await category(bid, "2026-11-01", cid, "2026-11-30")).target).not.toBeNull();
    // A refill target: December funded counts the leftover only once December is the current month.
    const r = await seed();
    await put(r.path, { cadence: "monthly", behavior: "refill", amount: 100000 }, "2026-11-30");
    const assign = (month: string, assigned: number) =>
      json(
        `/api/v1/budgets/${r.bid}/months/${month}/categories/${r.cid}`,
        { method: "PATCH" },
        { assigned },
      );
    expect((await assign("2026-11-01", 70000)).status).toBe(200);
    expect((await assign("2026-12-01", 10000)).status).toBe(200);
    const behind = await category(r.bid, "2026-12-01", r.cid, "2026-11-30");
    const ahead = await category(r.bid, "2026-12-01", r.cid, "2026-12-01");
    expect(behind.target.funded).toBe(10000);
    expect(ahead.target.funded).toBe(80000);
  });

  it("the summary accepts today and gives the same totals", async () => {
    const { bid } = await seed();
    const base = `/api/v1/budgets/${bid}/months/2026-11-01/summary`;
    const a = await (await json(base)).json();
    const b = await (await json(`${base}?today=2026-11-30`)).json();
    expect(b).toEqual(a);
    expect((await json(`${base}?today=nope`)).status).toBe(422);
  });
});
