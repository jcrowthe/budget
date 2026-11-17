import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { account, data, send, tool } from "./account-helpers";
import { type Json, plan } from "./bulk-helpers";

const L = (b: string, a: string, q = "include=running_balance") =>
  `/api/v1/budgets/${b}/accounts/${a}/transactions?${q}`;
const add = async (b: string, a: string, date: string, amount: number) => {
  const res = await send(`/api/v1/budgets/${b}/transactions`, "POST", {
    account_id: a,
    date,
    amount,
    inflow_to_ready_to_assign: amount > 0,
  });
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
};
const balances = async (b: string, a: string, q?: string) =>
  Object.fromEntries(
    ((await data(await send(L(b, a, q), "GET"))).transactions as Json[]).map((t) => [
      t.id,
      t.running_balance,
    ]),
  );

describe("running balance (EXF-529)", () => {
  it("the ticket's example, to the milliunit", async () => {
    const b = await plan();
    const acct = await account(b, "checking", 500000);
    const a = acct.id as string;
    const refund = await add(b, a, "2026-11-11", 30000);
    const fuel = await add(b, a, "2026-11-12", -20000);
    const big = await add(b, a, "2026-11-13", -600000);
    const rows = (await data(await send(L(b, a), "GET"))).transactions as Json[];
    const by = Object.fromEntries(rows.map((t) => [t.id, t.running_balance]));
    expect(by[refund.id]).toBe(530000);
    expect(by[fuel.id]).toBe(510000);
    expect(by[big.id]).toBe(-90000);
    const start = rows.find((t) => t.payee_system === "starting_balance") as Json;
    expect(start.running_balance).toBe(500000);
  });

  it("a same-day tie runs +500, +30, −20 into 500, 530, 510", async () => {
    const b = await plan();
    const a = (await account(b, "checking", 0)).id as string;
    const x = await add(b, a, "2027-03-01", 500000);
    const y = await add(b, a, "2027-03-01", 30000);
    const z = await add(b, a, "2027-03-01", -20000);
    const by = await balances(b, a);
    expect([by[x.id], by[y.id], by[z.id]]).toEqual([500000, 530000, 510000]);
  });

  it("filters do not change a row's balance; a deleted row and split lines do not count", async () => {
    const b = await plan();
    const a = (await account(b, "checking", 500000)).id as string;
    const refund = await add(b, a, "2026-11-11", 30000);
    const gone = await add(b, a, "2026-11-12", -5000);
    await send(`/api/v1/budgets/${b}/transactions/${gone.id}`, "DELETE");
    const cat = (await data(await send(`/api/v1/budgets/${b}/months/2026-11-01`, "GET"))).groups[0]
      .categories[0].id as string;
    const split = await send(`/api/v1/budgets/${b}/transactions`, "POST", {
      account_id: a,
      date: "2026-11-13",
      amount: -40000,
      subtransactions: [
        { amount: -10000, category_id: cat },
        { amount: -30000, category_id: cat },
      ],
    });
    expect(split.status).toBe(201);
    const splitId = (await data(split)).transaction.id as string;
    const all = await balances(b, a);
    expect(all[refund.id]).toBe(530000);
    expect(all[splitId]).toBe(490000);
    expect(Object.keys(all)).not.toContain(gone.id);
    const since = await balances(b, a, "include=running_balance&since_date=2026-11-11");
    expect(since[refund.id]).toBe(530000);
    expect(Object.keys(since)).toHaveLength(2);
    const sorted = await balances(b, a, "include=running_balance&sort=outflow&dir=asc");
    expect(sorted[refund.id]).toBe(530000);
  });

  it("a row without include has no running_balance key", async () => {
    const b = await plan();
    const a = (await account(b, "checking", 1000)).id as string;
    const rows = (await data(await send(L(b, a, ""), "GET"))).transactions as Json[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).not.toHaveProperty("running_balance");
    expect(env).toBeTruthy();
  });

  it("the list_transactions tool takes include with an account only", async () => {
    const b = await plan();
    const a = (await account(b, "checking", 1000)).id as string;
    const ok = await tool("list_transactions", {
      budget_id: b,
      account_id: a,
      include: "running_balance",
    });
    expect(JSON.parse(ok.content[0].text).transactions[0].running_balance).toBe(1000);
    const bad = await tool("list_transactions", { budget_id: b, include: "running_balance" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("running_balance needs account_id");
  });
});
