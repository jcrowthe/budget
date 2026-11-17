import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { data, account as openAccount, plan, send, tool } from "./account-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames } from "./surface";

// EXF-509: the read behind the Activity popover. Milliunits.
// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;
const actor = "user:tester@localhost";
const NOV = "2026-11-01";
const path = (bid: string, cat: string, month = NOV) =>
  `/api/v1/budgets/${bid}/months/${month}/categories/${cat}/transactions`;
const read = async (bid: string, cat: string, month = NOV) =>
  data(await json(path(bid, cat, month)));

/** The month read's `activity` for one category. */
async function engineActivity(bid: string, cat: string, query = "") {
  const m = await data(await json(`/api/v1/budgets/${bid}/months/${NOV}${query}`));
  return m.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.id === cat)
    .activity as number;
}

async function world() {
  const bid = await plan();
  const checking = await openAccount(bid, "checking", 0, "ZZ Checking");
  const old = await openAccount(bid, "checking", 0, "ZZ Old");
  const tracking = await openAccount(bid, "otherAsset", 0, "ZZ Tracking");
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Group" });
  const food = (
    await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "ZZ Food" })
  ).id;
  const other = (
    await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "ZZ Other" })
  ).id;
  return { bid, checking, old, tracking, food, other, g };
}

async function tx(bid: string, body: Json) {
  const res = await send(`/api/v1/budgets/${bid}/transactions`, "POST", {
    approved: true,
    ...body,
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await data(res)).transaction as Json;
}

describe("category activity read", () => {
  it("lists the rows the engine counts, and their sum is the month's activity", async () => {
    const w = await world();
    const { bid } = w;
    await tx(bid, {
      account_id: w.checking.id,
      date: "2026-11-15",
      amount: -60000,
      category_id: w.food,
      payee_name: "ZZ Shop",
    });
    await tx(bid, {
      account_id: w.checking.id,
      date: "2026-11-14",
      amount: 12000,
      category_id: w.food,
      payee_name: "ZZ Shop",
    });
    const split = await tx(bid, {
      account_id: w.checking.id,
      date: "2026-11-13",
      amount: -50000,
      subtransactions: [
        { amount: -30000, category_id: w.food },
        { amount: -20000, category_id: w.other },
      ],
    });
    await tx(bid, {
      account_id: w.checking.id,
      date: "2026-11-12",
      amount: -25000,
      category_id: w.food,
      transfer_account_id: w.tracking.id,
    });
    await tx(bid, { account_id: w.old.id, date: "2026-11-11", amount: -7000, category_id: w.food });
    const gone = await tx(bid, {
      account_id: w.checking.id,
      date: "2026-11-10",
      amount: -9000,
      category_id: w.food,
    });
    expect((await send(`/api/v1/budgets/${bid}/transactions/${gone.id}`, "DELETE")).status).toBe(
      200,
    );
    expect(
      (
        await send(`/api/v1/budgets/${bid}/scheduled-transactions?today=2026-11-16`, "POST", {
          account_id: w.checking.id,
          date_first: "2026-11-28",
          frequency: "monthly",
          amount: -40000,
          category_id: w.food,
        })
      ).status,
    ).toBe(201);
    await tx(bid, {
      account_id: w.checking.id,
      date: "2026-10-31",
      amount: -15000,
      category_id: w.food,
    });
    await tx(bid, {
      account_id: w.checking.id,
      date: "2026-12-01",
      amount: -16000,
      category_id: w.food,
    });
    expect((await send(`/api/v1/budgets/${bid}/accounts/${w.old.id}/close`, "POST")).status).toBe(
      200,
    );

    const r = await read(bid, w.food);
    expect(r.category_id).toBe(w.food);
    expect(r.month).toBe(NOV);
    expect(r.total_count).toBe(5);
    expect(r.transactions.map((t: Json) => t.amount)).toEqual([
      -60000, 12000, -30000, -25000, -7000,
    ]);
    expect(r.activity).toBe(-110000);
    expect(r.transactions.reduce((s: number, t: Json) => s + t.amount, 0)).toBe(r.activity);
    expect(await engineActivity(bid, w.food, "?today=2026-11-16")).toBe(r.activity);
    const line = r.transactions[2];
    expect(line.subtransaction_id).not.toBeNull();
    expect(line.id).toBe(split.id);
    expect(r.transactions[3].payee_name).toMatch(/^Transfer : /);
    expect(r.transactions[0]).toMatchObject({
      account_name: "ZZ Checking",
      date: "2026-11-15",
      payee_name: "ZZ Shop",
    });
    for (const t of r.transactions) expect([-9000, -15000, -16000, -40000]).not.toContain(t.amount);

    // MCP gives the same data.
    const viaTool = JSON.parse(
      (
        await tool("list_category_transactions", {
          budget_id: bid,
          category_id: w.food,
          month: NOV,
        })
      ).content[0].text,
    );
    expect(viaTool).toEqual(r);
  });

  it("answers 404 and 422 as the neighbouring reads do", async () => {
    const w = await world();
    const other = await world();
    expect((await json(path(w.bid, crypto.randomUUID()))).status).toBe(404);
    expect((await json(path(w.bid, "nope"))).status).toBe(404);
    expect((await json(path(w.bid, other.food))).status).toBe(404);
    expect((await json(path(crypto.randomUUID(), w.food))).status).toBe(404);
    expect((await json(path(other.bid, w.food))).status).toBe(404);
    expect((await json(path(w.bid, w.food, "2026-13-01"))).status).toBe(422);
  });

  it("refuses a credit card payment category with 422 payment_category", async () => {
    const w = await world();
    await openAccount(w.bid, "creditCard", 100000, "ZZ Visa");
    const m = await data(await json(`/api/v1/budgets/${w.bid}/months/${NOV}`));
    const pay = m.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.kind === "credit_card_payment");
    const res = await json(path(w.bid, pay.id));
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("payment_category");
    const t = await tool("list_category_transactions", {
      budget_id: w.bid,
      category_id: pay.id,
      month: NOV,
    });
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toContain("payment_category");
  });

  it("sends 500 rows of 503, with the count and the sum of all", async () => {
    const w = await world();
    const now = new Date().toISOString();
    const stmt = env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, category_id, amount, memo, cleared, approved, inflow_to_ready_to_assign, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'uncleared', 1, 0, ?, ?)",
    );
    const rows = Array.from({ length: 503 }, (_, i) =>
      stmt.bind(
        `zz-${crypto.randomUUID()}`,
        w.bid,
        w.checking.id,
        "2026-11-10",
        w.food,
        -(i + 1) * 10,
        `ZZ ${i}`,
        now,
        now,
      ),
    );
    await env.DB.batch(rows);
    const sum = -10 * ((503 * 504) / 2);
    const r = await read(w.bid, w.food);
    expect(r.transactions).toHaveLength(500);
    expect(r.total_count).toBe(503);
    expect(r.activity).toBe(sum);
    expect(await engineActivity(w.bid, w.food)).toBe(sum);
  });

  it("is on the API and tool lists", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/transactions",
    );
    expect(await listedToolNames()).toContain("list_category_transactions");
  });
});
