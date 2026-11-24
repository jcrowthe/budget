import { env } from "cloudflare:test";
import { CARD_TARGET_TYPES } from "@budget/core/card-targets";
import { CardTargetType } from "@budget/schema/targets";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { json } from "./helpers";
import { apiDocument, listedToolNames, mcpRpc } from "./surface";

// EXF-538: payment categories take card targets (Pay Off Balance by Date, Pay Specific Amount Monthly)
// through REST and MCP; the month read shows their figures. Milliunits; the ticket's examples.

// biome-ignore lint/suspicious/noExplicitAny: parsed bodies in tests
type Json = any;
const actor = "user:tester@localhost";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const TODAY = "2026-11-16";

const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);

async function world(owed = 1200000) {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
  const api = (p: string) => `/api/v1/budgets/${bid}${p}`;
  const open = async (name: string, type: string, balance: number) => {
    const res = await send(api("/accounts"), "POST", { name, type, balance, date: "2026-11-02" });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.account.id as string;
  };
  const checking = await open("ZZ Checking", "checking", 1000000);
  const card = await open("ZZ Card", "creditCard", owed);
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Group" });
  const food = (
    await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "ZZ Food" })
  ).id;
  const monthRead = async (m: string): Promise<Json> =>
    ((await (await json(api(`/months/${m}?today=${TODAY}`))).json()) as Json).data;
  const cats = async (m: string) => (await monthRead(m)).groups.flatMap((x: Json) => x.categories);
  const pay = ((await cats(NOV)).find((c: Json) => c.kind === "credit_card_payment") as Json)
    .id as string;
  const assign = (category_id: string, assigned: number, month = NOV) =>
    setAssigned(env, actor, { budget_id: bid, month, category_id, assigned });
  const put = (body: unknown, category = pay) =>
    send(api(`/categories/${category}/target?today=${TODAY}`), "PUT", body);
  const payCat = async (m = NOV) => (await cats(m)).find((c: Json) => c.id === pay) as Json;
  const logs = async () =>
    (
      await env.DB.prepare(
        "select actor, action, entity_type, entity_id from change_log where budget_id = ? and entity_type = 'target' order by rowid",
      )
        .bind(bid)
        .all<Json>()
    ).results;
  const stored = async () =>
    (await env.DB.prepare("select * from targets where budget_id = ?").bind(bid).all<Json>())
      .results;
  return {
    bid,
    api,
    checking,
    card,
    food,
    pay,
    assign,
    put,
    payCat,
    cats,
    logs,
    stored,
    monthRead,
  };
}

const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
};

describe("setting a card target", () => {
  it("REST and MCP accept both kinds; the history carries the actor; a replace keeps created_on", async () => {
    const w = await world();
    const res = await w.put({ type: "card_monthly", amount: 100000 });
    expect(res.status).toBe(200);
    const created = ((await res.json()) as Json).data.target;
    expect(created).toMatchObject({ type: "card_monthly", amount: 100000 });
    expect(created.created_month).toBe(NOV);
    expect((await w.logs()).map((l) => `${l.action} ${l.entity_type}`)).toEqual(["create target"]);
    expect((await w.logs())[0]?.actor).toBe(actor);

    const r = await mcp("set_card_payment_target", {
      budget_id: w.bid,
      category_id: w.pay,
      type: "card_payoff_by_date",
      month: "2027-02-01",
      today: "2026-12-20",
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.target).toMatchObject({
      type: "card_payoff_by_date",
      due_month: "2027-02-01",
      created_month: NOV,
    });
    const log = await w.logs();
    expect(log.map((l) => l.action)).toEqual(["create", "update"]);
    expect(log[1]?.actor.startsWith("mcp:")).toBe(true);
    expect(await w.stored()).toHaveLength(1);
  });

  it("refusals store and log nothing", async () => {
    const w = await world();
    const ordinary = (body: unknown) => w.put(body, w.food);
    const r1 = await ordinary({ type: "card_monthly", amount: 1000 });
    expect(r1.status).toBe(422);
    expect(((await r1.json()) as Json).error.code).toBe("card_target_requires_payment_category");
    const r2 = await w.put({ cadence: "monthly", behavior: "set_aside", amount: 1000 });
    expect(r2.status).toBe(422);
    expect(((await r2.json()) as Json).error.code).toBe("payment_category_target");
    for (const bad of [
      { type: "card_monthly", amount: 0 },
      { type: "card_monthly" },
      { type: "card_payoff_by_date" },
      { type: "card_payoff_by_date", month: "2027-02-15" },
      { type: "card_unknown", amount: 1000 },
    ]) {
      const r = await w.put(bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
      expect(((await r.json()) as Json).error.message.length).toBeGreaterThan(0);
    }
    // a bad ordinary body keeps its readable message
    const bad = await ordinary({ cadence: "weekly", behavior: "set_aside", amount: 1000 });
    expect(((await bad.json()) as Json).error.message).toContain("day_of_week");
    const m = await mcp("set_card_payment_target", {
      budget_id: w.bid,
      category_id: w.pay,
      type: "card_payoff_by_date",
    });
    expect(m.isError).toBe(true);
    const m2 = await mcp("set_card_payment_target", {
      budget_id: w.bid,
      category_id: w.food,
      type: "card_monthly",
      amount: 1000,
    });
    expect(m2.isError).toBe(true);
    expect(await w.stored()).toHaveLength(0);
    expect(await w.logs()).toHaveLength(0);
  });
});

describe("the month read (ticket examples)", () => {
  it("Pay Specific Amount Monthly: 100.00 a month", async () => {
    const w = await world();
    expect((await w.put({ type: "card_monthly", amount: 100000 })).status).toBe(200);
    expect((await w.payCat()).target).toMatchObject({
      status: "underfunded",
      needed_this_month: 100000,
      funded: 0,
      to_go_this_month: 100000,
      percent: 0,
    });
    await w.assign(w.pay, 100000);
    expect(await w.payCat()).toMatchObject({
      available: 100000,
      target: { status: "funded", to_go_this_month: 0, funded: 100000, percent: 100 },
    });
    expect((await w.payCat(DEC)).target).toMatchObject({
      status: "underfunded",
      to_go_this_month: 100000,
      needed_this_month: 100000,
    });
    expect(await w.payCat(DEC)).toMatchObject({ carried: 100000 });
  });

  it("Pay Off Balance by Date: 1,200.00 over four months is 300.00 a month", async () => {
    const w = await world();
    await w.assign(w.pay, 100000);
    await w.assign(w.food, 12000);
    const ok = async (r: Response) => expect(r.status).toBe(201);
    await ok(
      await send(w.api("/transactions"), "POST", {
        account_id: w.checking,
        date: "2026-11-10",
        amount: -100000,
        transfer_account_id: w.card,
      }),
    );
    await ok(
      await send(w.api("/transactions"), "POST", {
        account_id: w.card,
        date: "2026-11-10",
        amount: -12000,
        category_id: w.food,
      }),
    );
    expect((await w.put({ type: "card_payoff_by_date", month: "2027-02-01" })).status).toBe(200);
    const c = await w.payCat();
    expect(c.target).toMatchObject({
      status: "underfunded",
      needed_this_month: 300000,
      funded: 100000,
      to_go_this_month: 200000,
      overall_to_go: 1100000,
      percent: 8,
    });
    expect(c.payment).toMatchObject({
      prior_balance: -1200000,
      current_balance: -1112000,
      available: 12000,
    });
    // REST and MCP read the same month
    const viaMcp = await mcp("get_plan_month", { budget_id: w.bid, month: NOV, today: TODAY });
    expect(viaMcp.structuredContent).toEqual(await w.monthRead(NOV));
  });

  it("deleting the target restores the payment state", async () => {
    const w = await world();
    const before = await w.payCat();
    await w.put({ type: "card_payoff_by_date", month: "2027-02-01" });
    expect((await w.payCat()).target).not.toBeNull();
    const del = await send(w.api(`/categories/${w.pay}/target`), "DELETE");
    expect(del.status).toBe(200);
    expect(((await del.json()) as Json).data.deleted.type).toBe("card_payoff_by_date");
    const after = await w.payCat();
    expect(after.target).toBeNull();
    expect(after.payment).toEqual(before.payment);
    expect((await w.logs()).map((l) => l.action)).toEqual(["create", "delete"]);
  });
});

describe("surface", () => {
  it("the tool is listed, the enum matches core, OpenAPI documents both bodies", async () => {
    expect(await listedToolNames()).toContain("set_card_payment_target");
    expect(CardTargetType.options).toEqual([...CARD_TARGET_TYPES]);
    const doc = JSON.stringify(await apiDocument());
    expect(doc).toContain("card_payoff_by_date");
    expect(doc).toContain("card_monthly");
    expect(doc).toContain("TargetBody");
  });
});
