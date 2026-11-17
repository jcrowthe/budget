import { env } from "cloudflare:test";
import { MonthDetailResponse } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// EXF-537: the card's `payment` object, built row by row from the ticket's worked table through REST, plus
// the tool get_card_payment_status and the payment strategies of Auto-Assign. Milliunits.

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

async function world(cards: Record<string, number>, names: string[]) {
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
  // A positive balance on a card is money owed (stored negative).
  for (const [name, owed] of Object.entries(cards)) {
    accounts[name] = await open(name, "creditCard", owed);
  }
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Group" });
  const ids: Record<string, string> = {};
  for (const n of names) {
    ids[n] = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: n })).id;
  }
  const payId = async (card: string) => catByName(await readMonth(bid, NOV), card).id;
  const assign = async (name: string, assigned: number, month = NOV) => {
    const id = ids[name] ?? (await payId(name));
    await setAssigned(env, actor, { budget_id: bid, month, category_id: id, assigned });
  };
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
  };
  /** The card's `payment` from the month-category read, after checking the identities of every case. */
  const payment = async (card: string, month = NOV) => {
    const res = await json(
      `/api/v1/budgets/${bid}/months/${month}/categories/${await payId(card)}`,
    );
    expect(res.status).toBe(200);
    const p = ((await res.json()) as Json).data.payment;
    expect(
      p.prior_balance + p.spending_and_outflows + p.interest_charges + p.payments_and_inflows,
    ).toBe(p.current_balance);
    expect(p.interest_charges).toBe(0);
    expect(p.underfunded).toBe(Math.max(0, -p.current_balance - p.available));
    return p as Json;
  };
  return {
    bid,
    accounts,
    ids,
    assign,
    post,
    payId,
    payment,
    month: (m: string) => readMonth(bid, m),
  };
}

describe("EXF-537: the card payment object (the ticket's worked table)", () => {
  it("1: a Starting Balance and nothing assigned is underfunded", async () => {
    const w = await world({ "ZZ Debt Card": 1200000 }, []);
    expect(await w.payment("ZZ Debt Card")).toEqual({
      state: "underfunded",
      underfunded: 1200000,
      overspent_categories: 0,
      current_balance: -1200000,
      prior_balance: -1200000,
      spending_and_outflows: 0,
      interest_charges: 0,
      payments_and_inflows: 0,
      available: 0,
      paid: 0,
    });
  });

  it("2: spending that was funded is enough", async () => {
    const w = await world({ Visa: 0 }, ["Groceries"]);
    await w.assign("Groceries", 300000);
    await w.post("Visa", -120000, { category: "Groceries" });
    expect(await w.payment("Visa")).toMatchObject({
      state: "enough",
      current_balance: -120000,
      spending_and_outflows: -120000,
      available: 120000,
      underfunded: 0,
      prior_balance: 0,
    });
  });

  it("3: overspent categories, and the figures grow with each overspending row", async () => {
    const w = await world({ Visa: 0 }, ["Groceries", "Dining"]);
    await w.assign("Groceries", 170000);
    await w.assign("Dining", 0);
    await w.post("Visa", -170000, { category: "Groceries" });
    await w.post("Visa", -30000, { category: "Dining" });
    expect(await w.payment("Visa")).toMatchObject({
      state: "overspent_categories",
      overspent_categories: 30000,
      underfunded: 30000,
      current_balance: -200000,
    });
    for (const [row, figure] of [
      [-40000, 70000],
      [-20000, 90000],
      [-35000, 125000],
    ] as const) {
      await w.post("Visa", row, { category: "Dining" });
      expect(await w.payment("Visa")).toMatchObject({
        overspent_categories: figure,
        underfunded: figure,
      });
    }
  });

  it("4: the next month carries the debt and the funded part, with no overspent categories", async () => {
    const w = await world({ Visa: 0 }, ["Groceries", "Dining"]);
    await w.assign("Groceries", 210000);
    await w.post("Visa", -210000, { category: "Groceries" });
    await w.post("Visa", -110000, { category: "Dining" });
    expect(await w.payment("Visa", DEC)).toMatchObject({
      state: "underfunded",
      underfunded: 110000,
      overspent_categories: 0,
      current_balance: -320000,
      prior_balance: -320000,
      available: 210000,
    });
  });

  it("5 and 6: paying more than was set aside is overpaid, and paid off the month after", async () => {
    const w = await world({ Visa: 0 }, ["Groceries"]);
    await w.assign("Groceries", 335000);
    await w.post("Visa", -335000, { category: "Groceries" });
    await w.post("Checking", -385000, { to: "Visa" });
    expect(await w.payment("Visa")).toMatchObject({
      state: "overpaid",
      available: -50000,
      payments_and_inflows: 385000,
      paid: 385000,
      current_balance: 50000,
      underfunded: 0,
    });
    expect(await w.payment("Visa", DEC)).toMatchObject({
      state: "paid_off",
      available: 0,
      current_balance: 50000,
      prior_balance: 50000,
    });
  });

  it("7: a refund and an inflow are Payments and Inflows, but not paid", async () => {
    const w = await world({ Visa: 0 }, ["Groceries"]);
    await w.post("Visa", 15000, { category: "Groceries" });
    await w.post("Visa", 30000, { inflow: true });
    expect(await w.payment("Visa")).toMatchObject({ payments_and_inflows: 45000, paid: 0 });
  });

  it("8: the month read carries payment on payment categories only", async () => {
    const w = await world({ Visa: 0 }, ["Groceries", "Dining"]);
    await w.assign("Groceries", 170000);
    await w.post("Visa", -170000, { category: "Groceries" });
    await w.post("Visa", -30000, { category: "Dining" });
    const p = await w.payment("Visa");
    const m = await w.month(NOV);
    expect(catByName(m, "Visa").payment).toEqual(p);
    for (const c of m.groups.flatMap((g) => g.categories)) {
      if (c.kind !== "credit_card_payment") expect(c.payment).toBeNull();
    }
    const res = await json(`/api/v1/budgets/${w.bid}/months/${NOV}/categories/${w.ids.Groceries}`);
    expect(((await res.json()) as Json).data.payment).toBeNull();
  });

  it("9: get_card_payment_status equals the REST payment, and refuses other ids", async () => {
    const w = await world({ Visa: 0 }, ["Groceries", "Dining"]);
    await w.assign("Groceries", 170000);
    await w.post("Visa", -170000, { category: "Groceries" });
    await w.post("Visa", -30000, { category: "Dining" });
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const call = async (args: unknown) => {
      const r = await mcpRpc("tools/call", { name: "get_card_payment_status", arguments: args }, 2);
      const result = r.body.result as Json;
      return { error: result.isError === true, data: result.content[0].text as string };
    };
    const ok = await call({ budget_id: w.bid, month: NOV, account_id: w.accounts.Visa });
    expect(ok.error).toBe(false);
    expect(JSON.parse(ok.data)).toEqual({
      account_id: w.accounts.Visa,
      category_id: await w.payId("Visa"),
      name: "Visa",
      ...(await w.payment("Visa")),
    });
    expect(
      (await call({ budget_id: w.bid, month: NOV, account_id: w.accounts.Checking })).error,
    ).toBe(true);
    expect((await call({ budget_id: w.bid, month: NOV, account_id: "nope" })).error).toBe(true);
  });
});

describe("EXF-537: Auto-Assign for payment categories", () => {
  const ref = (bid: string, month: string, q = "") =>
    `/api/v1/budgets/${bid}/months/${month}/auto-assign${q}`;
  const preview = async (bid: string, month: string, q = "") =>
    ((await (await json(ref(bid, month, q))).json()) as Json).data;

  it("11: Underfunded of a lone card assigns the Total Underfunded; plan-wide it is 0", async () => {
    const w = await world({ "ZZ Debt Card": 1200000 }, []);
    const pay = await w.payId("ZZ Debt Card");
    expect((await preview(w.bid, NOV, `?category_ids=${pay}`)).underfunded).toBe(1200000);
    expect((await preview(w.bid, NOV)).underfunded).toBe(0);
    const res = await send(ref(w.bid, NOV), "POST", {
      strategy: "underfunded",
      category_ids: [pay],
    });
    expect(res.status).toBe(200);
    expect(await w.payment("ZZ Debt Card")).toMatchObject({ state: "enough", available: 1200000 });
  });

  it("11: Paid Last Month and Average Paid come from transfers into the card", async () => {
    const w = await world({ Visa: 0 }, ["Groceries"]);
    await w.post("Checking", -100000, { to: "Visa", date: "2026-10-15" });
    const pay = await w.payId("Visa");
    const p = await preview(w.bid, NOV, `?category_ids=${pay}`);
    expect(p.paid_last_month).toBe(100000);
    expect(p.average_paid).toBe(100000);
    const res = await send(ref(w.bid, NOV), "POST", {
      strategy: "paid_last_month",
      category_ids: [pay],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.changed).toEqual([
      { month: NOV, category_id: pay, assigned: 100000 },
    ]);
    // An ordinary category keeps its Assigned under the payment strategies.
    for (const strategy of ["paid_last_month", "average_paid"]) {
      const r = await send(ref(w.bid, NOV), "POST", { strategy, category_ids: [w.ids.Groceries] });
      expect(((await r.json()) as Json).data.changed).toEqual([]);
    }
  });
});
