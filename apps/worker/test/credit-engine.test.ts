import { env } from "cloudflare:test";
import { MonthDetailResponse } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// EXF-532 examples A, B, C and EXF-535 steps 1-11, through REST (and MCP for the read). Milliunits.

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;
const actor = "user:tester@localhost";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const DAY = "2026-11-10";

const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);

async function readMonth(bid: string, month: string) {
  const res = await json(`/api/v1/budgets/${bid}/months/${month}`);
  expect(res.status).toBe(200);
  return MonthDetailResponse.parse(await res.json()).data;
}
type Month = Awaited<ReturnType<typeof readMonth>>;
const catByName = (m: Month, name: string) => {
  const c = m.groups.flatMap((g) => g.categories).find((x) => x.name === name);
  if (!c) throw new Error(`no category ${name}`);
  return c;
};

async function world(cards: Record<string, { type?: string; balance?: number }>, names: string[]) {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
  const open = async (name: string, type: string, balance: number) => {
    const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
      name,
      type,
      balance,
      date: "2026-11-02",
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.account.id as string;
  };
  const accounts: Record<string, string> = {
    Checking: await open("Checking", "checking", 1000000),
  };
  for (const [name, c] of Object.entries(cards)) {
    accounts[name] = await open(name, c.type ?? "creditCard", c.balance ?? 0);
  }
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Group" });
  const ids: Record<string, string> = {};
  for (const n of names) {
    ids[n] = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: n })).id;
  }
  const assign = async (name: string, assigned: number, month = NOV) => {
    const id = ids[name] ?? (await payId(name));
    await setAssigned(env, actor, { budget_id: bid, month, category_id: id, assigned });
  };
  const payId = async (card: string) => catByName(await readMonth(bid, NOV), card).id;
  const post = async (account: string, amount: number, o: Json = {}) => {
    const res = await send(`/api/v1/budgets/${bid}/transactions`, "POST", {
      account_id: accounts[account],
      date: DAY,
      amount,
      ...(o.category ? { category_id: ids[o.category] } : {}),
      ...(o.inflow ? { inflow_to_ready_to_assign: true } : {}),
      ...(o.to ? { transfer_account_id: accounts[o.to] } : {}),
      ...(o.date ? { date: o.date } : {}),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.transaction;
  };
  const balance = async (account: string) => {
    const res = await json(`/api/v1/budgets/${bid}/accounts/${accounts[account]}`);
    return ((await res.json()) as Json).data.account.balance as number;
  };
  return { bid, accounts, ids, assign, post, balance, month: (m: string) => readMonth(bid, m) };
}

describe("EXF-535 steps 1-11 and the December reads", () => {
  it("replays the eleven steps", async () => {
    const w = await world({ Visa: {} }, ["Groceries", "Dining", "Empty", "Mixed", "Order"]);
    await w.assign("Groceries", 300000);
    await w.assign("Dining", 50000);
    await w.assign("Mixed", 50000);
    await w.assign("Order", 50000);
    const pay = async () => catByName(await w.month(NOV), "Visa");

    await w.post("Visa", -120000, { category: "Groceries" });
    let m = await w.month(NOV);
    expect(catByName(m, "Groceries")).toMatchObject({
      available: 180000,
      credit_spending: -120000,
    });
    expect((await pay()).activity).toBe(120000);

    await w.post("Visa", -80000, { category: "Dining" });
    m = await w.month(NOV);
    expect(catByName(m, "Dining")).toMatchObject({
      available: -30000,
      state: "credit_overspent",
      overspent: { cash: 0, credit: 30000 },
    });
    expect((await pay()).activity).toBe(170000);

    await w.post("Checking", -25000, { category: "Empty" });
    m = await w.month(NOV);
    expect(catByName(m, "Empty")).toMatchObject({
      available: -25000,
      state: "cash_overspent",
      overspent: { cash: 25000, credit: 0 },
    });
    expect((await pay()).activity).toBe(170000);

    await w.post("Visa", -40000, { category: "Empty" });
    m = await w.month(NOV);
    expect(catByName(m, "Empty")).toMatchObject({
      available: -65000,
      state: "cash_overspent",
      overspent: { cash: 25000, credit: 40000 },
      cash_spending: -25000,
      credit_spending: -40000,
    });
    expect((await pay()).activity).toBe(170000);

    // Step 5: cash first, then card (Mixed). Step 6: card dated 11-10, cash dated 11-12 (Order).
    await w.post("Checking", -30000, { category: "Mixed" });
    await w.post("Visa", -40000, { category: "Mixed" });
    expect((await pay()).activity).toBe(190000);
    await w.post("Visa", -40000, { category: "Order", date: "2026-11-10" });
    await w.post("Checking", -30000, { category: "Order", date: "2026-11-12" });
    m = await w.month(NOV);
    const mixed = catByName(m, "Mixed");
    const order = catByName(m, "Order");
    for (const c of [mixed, order]) {
      expect(c).toMatchObject({
        available: -20000,
        state: "credit_overspent",
        overspent: { cash: 0, credit: 20000 },
      });
    }
    expect((await pay()).activity).toBe(210000);
    expect(await w.balance("Visa")).toBe(-320000);
    expect((await pay()).available).toBe(210000);

    // December, nothing new in December.
    const dec = await w.month(DEC);
    for (const n of ["Dining", "Empty", "Mixed", "Order"]) {
      expect(catByName(dec, n)).toMatchObject({ available: 0, state: "ok" });
    }
    expect(catByName(dec, "Groceries").available).toBe(180000);
    expect(catByName(dec, "Visa").available).toBe(210000);
    const novRta = (await w.month(NOV)).ready_to_assign;
    const decRta = dec.ready_to_assign;

    // Step 7: cash overspending lowers December's RTA by exactly 10.00, November's is unchanged.
    await w.post("Checking", -10000, { category: "Empty" });
    m = await w.month(NOV);
    expect(catByName(m, "Empty")).toMatchObject({
      available: -75000,
      overspent: { cash: 35000, credit: 40000 },
    });
    expect(m.ready_to_assign).toBe(novRta);
    expect((await w.month(DEC)).ready_to_assign).toBe(decRta - 10000);
    expect((await pay()).activity).toBe(210000);

    // Step 8: card overspending leaves December alone.
    await w.post("Visa", -10000, { category: "Dining" });
    await w.post("Visa", -5000, { category: "Dining" });
    m = await w.month(NOV);
    expect(catByName(m, "Dining")).toMatchObject({ available: -45000, state: "credit_overspent" });
    expect((await w.month(DEC)).ready_to_assign).toBe(decRta - 10000);
    expect((await pay()).activity).toBe(210000);
    expect(await w.balance("Visa")).toBe(-335000);

    // Step 9: cover Dining from Groceries (45.00).
    const cover = await send(
      `/api/v1/budgets/${w.bid}/months/${NOV}/categories/${w.ids.Dining}/cover`,
      "POST",
      { from: w.ids.Groceries },
    );
    expect(cover.status).toBe(200);
    m = await w.month(NOV);
    expect(catByName(m, "Groceries")).toMatchObject({ assigned: 255000, available: 135000 });
    expect(catByName(m, "Dining")).toMatchObject({ assigned: 95000, available: 0, state: "ok" });
    expect((await pay()).activity).toBe(255000);

    // Step 10: assign Empty 75.00: +40.00, the credit part only.
    await w.assign("Empty", 75000);
    m = await w.month(NOV);
    expect(catByName(m, "Empty")).toMatchObject({ available: 0, state: "ok", overspent: null });
    expect((await pay()).activity).toBe(295000);

    // Step 11.
    await w.assign("Order", 70000);
    await w.assign("Mixed", 70000);
    m = await w.month(NOV);
    for (const n of ["Empty", "Order", "Mixed", "Dining"]) {
      expect(catByName(m, n)).toMatchObject({ available: 0, state: "ok" });
    }
    expect((await pay()).activity).toBe(335000);
    expect(await w.balance("Visa")).toBe(-335000);
  });

  it("covering part of a cash-only overspending leaves the card alone", async () => {
    const w = await world({ Visa: {} }, ["Cashy"]);
    await w.post("Checking", -25000, { category: "Cashy" });
    const before = catByName(await w.month(NOV), "Visa").activity;
    await w.assign("Cashy", 10000);
    expect(catByName(await w.month(NOV), "Visa").activity).toBe(before);
    expect(catByName(await w.month(NOV), "Cashy").overspent).toEqual({ cash: 15000, credit: 0 });
  });

  it("a partly covered category overspent with cash and credit loses its cash part first", async () => {
    const w = await world({ Visa: {} }, ["Mixed"]);
    await w.post("Checking", -25000, { category: "Mixed" });
    await w.post("Visa", -40000, { category: "Mixed" });
    // Dec's cash_overspending_previous is the negative of the cash part (see the 10.00 case below).
    const rows = [
      {
        assigned: 0,
        available: -65000,
        cash: 25000,
        credit: 40000,
        state: "cash_overspent",
        pay: 0,
      },
      {
        assigned: 10000,
        available: -55000,
        cash: 15000,
        credit: 40000,
        state: "cash_overspent",
        pay: 0,
      },
      {
        assigned: 25000,
        available: -40000,
        cash: 0,
        credit: 40000,
        state: "credit_overspent",
        pay: 0,
      },
      {
        assigned: 35000,
        available: -30000,
        cash: 0,
        credit: 30000,
        state: "credit_overspent",
        pay: 10000,
      },
    ];
    for (const r of rows) {
      await w.assign("Mixed", r.assigned);
      const nov = await w.month(NOV);
      expect(catByName(nov, "Mixed"), `assigned ${r.assigned}`).toMatchObject({
        available: r.available,
        overspent: { cash: r.cash, credit: r.credit },
        state: r.state,
      });
      expect(catByName(nov, "Visa").activity, `payment at ${r.assigned}`).toBe(r.pay);
      expect(
        (await w.month(DEC)).rta_breakdown.cash_overspending_previous,
        `December at ${r.assigned}`,
      ).toBe(r.cash === 0 ? 0 : -r.cash);
    }
  });

  it("a 10.00 cash overspending lowers December's Ready to Assign, a 5.00 credit one does not", async () => {
    const w = await world({ Visa: {} }, ["Dining"]);
    const d0 = (await w.month(DEC)).ready_to_assign;
    await w.post("Visa", -5000, { category: "Dining" });
    expect((await w.month(DEC)).ready_to_assign).toBe(d0);
    await w.post("Checking", -10000, { category: "Dining" });
    const dec = await w.month(DEC);
    expect(dec.ready_to_assign).toBe(d0 - 10000);
    expect(dec.rta_breakdown.cash_overspending_previous).toBe(-10000);
  });
});

describe("EXF-532 example A, B, C through the API", () => {
  it("A: payments, a negative payment Available, December", async () => {
    const w = await world({ Visa: {} }, ["Groceries"]);
    await w.assign("Groceries", 300000);
    await w.post("Visa", -335000, { category: "Groceries" });
    await w.assign("Groceries", 400000);
    expect(catByName(await w.month(NOV), "Visa")).toMatchObject({
      activity: 335000,
      available: 335000,
    });
    const decBefore = (await w.month(DEC)).ready_to_assign;
    await w.post("Checking", -200000, { to: "Visa", date: "2026-11-11" });
    expect(catByName(await w.month(NOV), "Visa")).toMatchObject({
      activity: 135000,
      available: 135000,
    });
    expect(await w.balance("Visa")).toBe(-135000);
    const one = (await w.month(DEC)).ready_to_assign;
    expect(one).toBe(decBefore);
    await w.post("Checking", -185000, { to: "Visa", date: "2026-11-12" });
    const nov = await w.month(NOV);
    expect(catByName(nov, "Visa")).toMatchObject({
      activity: -50000,
      available: -50000,
      state: "cash_overspent",
    });
    expect(await w.balance("Visa")).toBe(50000);
    const dec = await w.month(DEC);
    expect(catByName(dec, "Visa").available).toBe(0);
    expect(dec.ready_to_assign).toBe(one - 50000);
  });

  it("B: a line of credit with a refund and two inflows", async () => {
    const w = await world({ LOC: { type: "lineOfCredit" } }, ["Groceries"]);
    await w.assign("Groceries", 300000);
    await w.post("LOC", -100000, { category: "Groceries" });
    expect(catByName(await w.month(NOV), "LOC")).toMatchObject({
      activity: 100000,
      available: 100000,
    });
    await w.post("LOC", 30000, { category: "Groceries" });
    const m = await w.month(NOV);
    expect(catByName(m, "Groceries").credit_spending).toBe(-70000);
    expect(catByName(m, "LOC")).toMatchObject({ activity: 70000, available: 70000 });
    expect(await w.balance("LOC")).toBe(-70000);
    await w.post("LOC", 15000, { inflow: true });
    const m2 = await w.month(NOV);
    expect(m2.ready_to_assign).toBe(m.ready_to_assign + 15000);
    expect(catByName(m2, "LOC").available).toBe(70000);
    expect(await w.balance("LOC")).toBe(-55000);
    await w.post("LOC", 777770, { inflow: true });
    const m3 = await w.month(NOV);
    expect(m3.ready_to_assign).toBe(m2.ready_to_assign + 777770);
    expect(catByName(m3, "LOC").available).toBe(70000);
    // -70.00 + 15.00 + 777.77 = 722.77 (the ticket prints +727.77, which does not follow from its own steps)
    expect(await w.balance("LOC")).toBe(722770);
  });

  it("C: a card opened with debt", async () => {
    const w = await world({ "Debt Card": { balance: 1200000 } }, ["Interest"]);
    const m0 = await w.month(NOV);
    const rta0 = m0.ready_to_assign;
    expect(await w.balance("Debt Card")).toBe(-1200000);
    expect(catByName(m0, "Debt Card")).toMatchObject({ activity: 0, available: 0 });
    await w.assign("Debt Card", 100000);
    expect(catByName(await w.month(NOV), "Debt Card").available).toBe(100000);
    await w.post("Checking", -100000, { to: "Debt Card" });
    expect(catByName(await w.month(NOV), "Debt Card")).toMatchObject({
      activity: -100000,
      available: 0,
    });
    expect(await w.balance("Debt Card")).toBe(-1100000);
    await w.assign("Interest", 20000);
    await w.post("Debt Card", -12000, { category: "Interest" });
    const m = await w.month(NOV);
    expect(catByName(m, "Debt Card").available).toBe(12000);
    expect(catByName(m, "Interest").available).toBe(8000);
    expect(await w.balance("Debt Card")).toBe(-1112000);
    expect(m.ready_to_assign).toBe(rta0 - 100000 - 20000);
  });
});

describe("EXF-535 two cards and the tool read", () => {
  it("splits the credit part to the milliunit between two cards", async () => {
    const w = await world({ A: {}, B: {} }, ["C"]);
    await w.post("A", -30000, { category: "C" });
    await w.post("B", -10000, { category: "C" });
    await w.assign("C", 10001);
    const m = await w.month(NOV);
    expect(catByName(m, "A").activity).toBe(30000 - 22499);
    expect(catByName(m, "B").activity).toBe(10000 - 7500);
    expect(catByName(m, "C").overspent).toEqual({ cash: 0, credit: 29999 });
  });

  it("get_plan_month and get_month_category agree with REST", async () => {
    const w = await world({ Visa: {} }, ["Dining"]);
    await w.assign("Dining", 50000);
    await w.post("Visa", -80000, { category: "Dining" });
    await w.post("Visa", -15000, { category: "Dining" });
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const call = async (name: string, args: unknown) => {
      const r = await mcpRpc("tools/call", { name, arguments: args }, 2);
      return JSON.parse((r.body.result as Json).content[0].text) as Json;
    };
    const viaTool = await call("get_plan_month", { budget_id: w.bid, month: NOV });
    const viaRest = await w.month(NOV);
    expect(MonthDetailResponse.parse({ data: viaTool }).data).toEqual(viaRest);
    const dining = await call("get_month_category", {
      budget_id: w.bid,
      month: NOV,
      category_id: w.ids.Dining,
    });
    expect(dining).toMatchObject({ credit_activity: -95000, cash_activity: 0 });
  });

  it("Auto-Assign: a payment category takes part in Assigned Last Month, not in Spent Last Month", async () => {
    const w = await world({ Visa: {} }, ["Dining"]);
    const OCT = "2026-10-01";
    await w.assign("Visa", 5000, OCT);
    const preview = await json(`/api/v1/budgets/${w.bid}/months/${NOV}/auto-assign`);
    expect(preview.status).toBe(200);
    const p = ((await preview.json()) as Json).data;
    expect(p.assigned_last_month).toBe(5000);
    expect(p.spent_last_month).toBe(0);
    const visaId = (await w.month(NOV)).groups
      .flatMap((g) => g.categories)
      .find((c) => c.name === "Visa")?.id;
    const apply = async (strategy: string) =>
      send(`/api/v1/budgets/${w.bid}/months/${NOV}/auto-assign`, "POST", {
        strategy,
        category_ids: [visaId],
      });
    expect((await apply("assigned_last_month")).status).toBe(200);
    expect(catByName(await w.month(NOV), "Visa").assigned).toBe(5000);
    expect((await apply("spent_last_month")).status).toBe(200);
    expect(catByName(await w.month(NOV), "Visa").assigned).toBe(5000);
  });
});
