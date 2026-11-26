import { env } from "cloudflare:test";
import { targetStatusText } from "@budget/schema/target-wording";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { pinClock } from "./clock";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

pinClock("2026-11-15T12:00:00Z"); // fixed-month fixtures (EXF-977)

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

  it("a bad today is a 422 on all four operations and both tools, and stores nothing", async () => {
    const { bid, cid, path } = await seed();
    const msg = "today must be a real date, YYYY-MM-DD";
    for (const bad of ["nope", "2026-11-1", "2026-02-30", "2300-01-01", "1899-12-31"]) {
      const q = `?today=${bad}`;
      for (const url of [
        `/api/v1/budgets/${bid}/months/2026-11-01${q}`,
        `/api/v1/budgets/${bid}/months/2026-11-01/summary${q}`,
      ]) {
        const res = await json(url);
        expect(res.status, url).toBe(422);
        expect(JSON.stringify(await res.json()), url).toContain(msg);
      }
      const put422 = await put(path, MONTHLY, bad);
      expect(put422.status, bad).toBe(422);
      expect(JSON.stringify(await put422.json())).toContain(msg);
      const read = await mcp("get_plan_month", { budget_id: bid, month: "2026-11-01", today: bad });
      expect(read.isError, bad).toBe(true);
      expect(JSON.stringify(read)).toContain(msg);
      const set = await mcp("set_category_target", {
        budget_id: bid,
        category_id: cid,
        ...MONTHLY,
        today: bad,
      });
      expect(set.isError, bad).toBe(true);
      expect(JSON.stringify(set)).toContain(msg);
    }
    expect((await category(bid, "2026-11-01", cid)).target).toBeNull();
    expect(await logs(cid)).toEqual([]);
  });

  it("accepts the far dates 1990-01-15 and 2150-06-30 as given", async () => {
    for (const [today, month] of [
      ["1990-01-15", "1990-01-01"],
      ["2150-06-30", "2150-06-01"],
    ] as const) {
      const { bid, cid, path } = await seed();
      const res = await put(path, MONTHLY, today);
      expect(res.status, today).toBe(200);
      expect(((await res.json()) as Json).data.target.created_month).toBe(month);
      expect((await category(bid, month, cid, today)).target).not.toBeNull();
      expect(
        (await json(`/api/v1/budgets/${bid}/months/${month}/summary?today=${today}`)).status,
      ).toBe(200);
    }
  });

  it("set_category_target's description gives one sentence per kind", async () => {
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const tools = (await mcpRpc("tools/list", {}, 2)).body.result?.tools as Json[];
    const d: string = tools.find((t) => t.name === "set_category_target").description;
    // Design doc, Acceptance case 21 (point 4): one sentence per kind, the rest unchanged.
    expect(d).toContain(
      "Kinds: weekly (set_aside or refill; amount each week on day_of_week, 0 = Sunday); " +
        "monthly (set_aside or refill; amount each month by day_of_month, null or absent = the last day); " +
        "yearly (set_aside or refill; amount each year by due_date); " +
        "custom set_aside or fill_up (amount by due_date, optional repeat every 1 to 11 months or years); " +
        "custom balance (reach amount by due_month, or eventually when it is absent). " +
        "Other combinations are refused.",
    );
    expect(d).toContain(
      "Create or replace a category's target; a replace keeps the first creation date.",
    );
    expect(d).toContain("Returns { target }: the stored target with its fields and created_month");
    expect(d).toContain(
      "today (YYYY-MM-DD, default the server's UTC date) sets the creation month of a new target.",
    );
  });

  it("a split across two categories leaves the target's figures as a plain spend does", async () => {
    const run = async (split: boolean) => {
      const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
      const group = await createCategoryGroup(env, actor, { budget_id: bid, name: "Bills" });
      const g = (
        await createCategory(env, actor, { budget_id: bid, group_id: group.id, name: "Groceries" })
      ).id;
      const dn = (
        await createCategory(env, actor, { budget_id: bid, group_id: group.id, name: "Dining out" })
      ).id;
      const acct = await json(
        `/api/v1/budgets/${bid}/accounts`,
        { method: "POST" },
        {
          name: "ZZ Chk",
          type: "checking",
          balance: 500000,
          date: "2026-11-01",
        },
      );
      const aid = ((await acct.json()) as Json).data.account.id as string;
      const t = await put(`/api/v1/budgets/${bid}/categories/${g}/target`, MONTHLY, "2026-11-10");
      expect(t.status).toBe(200);
      const a = await json(
        `/api/v1/budgets/${bid}/months/2026-11-01/categories/${g}`,
        { method: "PATCH" },
        { assigned: 100000 },
      );
      expect(a.status).toBe(200);
      const tx = await json(
        `/api/v1/budgets/${bid}/transactions`,
        { method: "POST" },
        split
          ? {
              account_id: aid,
              date: "2026-11-10",
              amount: -100000,
              subtransactions: [
                { amount: -60000, category_id: g },
                { amount: -40000, category_id: dn },
              ],
            }
          : { account_id: aid, date: "2026-11-10", amount: -60000, category_id: g },
      );
      expect(tx.status).toBe(201);
      return category(bid, "2026-11-01", g, "2026-11-10");
    };
    const split = await run(true);
    const plain = await run(false);
    expect(split.activity).toBe(-60000);
    expect(split.target).toMatchObject({ funded: 100000, status: "funded" });
    expect(split.target).toEqual(plain.target);
    const text = targetStatusText(split);
    expect(`${text?.amount ?? ""}${text?.text ?? ""}`.replace(/\s+/g, " ")).toContain("Funded");
    expect(JSON.stringify(text)).toContain("Spent $60.00 of $100.00");
  });
});
