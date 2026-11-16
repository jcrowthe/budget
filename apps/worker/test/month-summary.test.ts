import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/services/accounts";
import { setAssigned } from "../src/services/months";
import { createTransaction } from "../src/services/transactions";
import { actor, api, cat, type Json, mcp, month, plan, send } from "./category-helpers";
import { apiDocument, apiPaths, listedToolNames } from "./surface";

const NOV = "2026-11-01";
const DEC = "2026-12-01";

async function seed() {
  const bid = await plan();
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  const m = await month(bid, NOV);
  const id = (n: string) => cat(m, n).id;
  const groceries = id("🛒 Groceries");
  const rent = id("🏠 Rent/Mortgage");
  const hidden = id("🍿 Entertainment");
  const tx = (amount: number, category: string | null, inflow = false) =>
    createTransaction(env, actor, {
      budget_id: bid,
      account_id: account.id,
      date: "2026-11-05",
      amount,
      category_id: category,
      inflow_to_ready_to_assign: inflow,
    });
  const assign = (category_id: string, month: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month, category_id, assigned });
  await tx(500000, null, true);
  await assign(groceries, NOV, 100000);
  await assign(rent, NOV, 50000);
  await assign(hidden, NOV, 20000);
  await tx(-30000, groceries);
  await send("PATCH", api(bid, `/categories/${hidden}`), { hidden: true });
  const summary = async (q = "") => {
    const res = await send("GET", api(bid, `/months/${NOV}/summary${q}`));
    return { status: res.status, body: (await res.json()) as Json };
  };
  return { bid, groceries, rent, hidden, assign, summary };
}

describe("month summary", () => {
  it("sums the visible categories, or exactly the listed ones", async () => {
    const s = await seed();
    const all = await s.summary();
    expect(all.status).toBe(200);
    expect(all.body.data).toEqual({
      leftover: 0,
      assigned: 150000,
      activity: -30000,
      available: 120000,
    });
    const some = await s.summary(`?category_ids=${s.groceries},${s.hidden}`);
    expect(some.body.data).toEqual({
      leftover: 0,
      assigned: 120000,
      activity: -30000,
      available: 90000,
    });
    const t = all.body.data;
    expect(t.available).toBe(t.leftover + t.assigned + t.activity);
  });

  it("get_month_summary matches the REST read, with and without category_ids", async () => {
    const s = await seed();
    const a = await mcp("get_month_summary", { budget_id: s.bid, month: NOV });
    expect(a.structuredContent).toEqual((await s.summary()).body.data);
    const ids = [s.rent, s.groceries];
    const b = await mcp("get_month_summary", { budget_id: s.bid, month: NOV, category_ids: ids });
    expect(b.structuredContent).toEqual(
      (await s.summary(`?category_ids=${ids.join(",")}`)).body.data,
    );
    expect(
      (
        await mcp("get_month_summary", {
          budget_id: s.bid,
          month: NOV,
          category_ids: [crypto.randomUUID()],
        })
      ).isError,
    ).toBe(true);
  });

  it("answers 404 for an unknown category or plan and 422 for an empty list", async () => {
    const s = await seed();
    expect((await s.summary(`?category_ids=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await s.summary("?category_ids=")).status).toBe(422);
    expect((await s.summary(`?category_ids=${s.rent},`)).status).toBe(422);
    const res = await send("GET", api(crypto.randomUUID(), `/months/${NOV}/summary`));
    expect(res.status).toBe(404);
  });
});

describe("category month", () => {
  it("gives the EXF-521 examples and the tool agrees", async () => {
    const s = await seed();
    const read = async (m: string) => {
      const res = await send("GET", api(s.bid, `/months/${m}/categories/${s.groceries}`));
      expect(res.status).toBe(200);
      return ((await res.json()) as Json).data;
    };
    expect(await read(NOV)).toEqual({
      leftover: 0,
      assigned: 100000,
      cash_activity: -30000,
      credit_activity: 0,
      available: 70000,
      note: null,
    });
    await s.assign(s.groceries, DEC, 30000);
    const dec = await read(DEC);
    expect(dec).toMatchObject({
      leftover: 70000,
      assigned: 30000,
      cash_activity: 0,
      available: 100000,
    });
    const viaMcp = await mcp("get_month_category", {
      budget_id: s.bid,
      month: DEC,
      category_id: s.groceries,
    });
    expect(viaMcp.structuredContent).toEqual(dec);
    expect(
      (await send("GET", api(s.bid, `/months/${NOV}/categories/${crypto.randomUUID()}`))).status,
    ).toBe(404);
  });
});

describe("surface", () => {
  it("lists the new paths and tools", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/months/{month}/summary");
    const doc = (await apiDocument()).paths as Record<string, Record<string, unknown>>;
    expect(
      doc["/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}"]?.get,
    ).toBeDefined();
    const tools = await listedToolNames();
    expect(tools).toContain("get_month_summary");
    expect(tools).toContain("get_month_category");
  });
});
