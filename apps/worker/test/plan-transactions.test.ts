import { env } from "cloudflare:test";
import { sortTransactions } from "@budget/schema/register";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);

async function account(bid: string, name: string, type: string, balance: number, date: string) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", { name, type, balance, date });
  return ((await res.json()) as Json).data.account.id as string;
}
const tx = async (
  bid: string,
  account_id: string,
  date: string,
  amount: number,
  cleared?: string,
) =>
  (
    (await (
      await send(`/api/v1/budgets/${bid}/transactions`, "POST", {
        account_id,
        date,
        amount,
        cleared,
      })
    ).json()) as Json
  ).data.transaction.id as string;
const all = async (bid: string, query = "") => {
  const res = await json(`/api/v1/budgets/${bid}/transactions${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
};

async function fixture() {
  const bid = await plan();
  const a = await account(bid, "ZZ Bravo", "checking", 250000, "2026-11-01");
  const b = await account(bid, "ZZ Alpha", "otherAsset", 5000000, "2026-11-02");
  const c = await account(bid, "ZZ Charlie", "savings", 700000, "2026-11-03");
  await tx(bid, a, "2026-11-08", -1000);
  await tx(bid, b, "2026-11-09", 2000, "cleared");
  await tx(bid, c, "2026-11-10", 3000);
  const gone = await tx(bid, a, "2026-11-11", -9999);
  await send(`/api/v1/budgets/${bid}/transactions/${gone}`, "DELETE");
  await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(c).run();
  return { bid, a, b, c, gone };
}

describe("plan-wide transactions", () => {
  it("lists every non-deleted row, open and closed, newest first, with account names", async () => {
    const { bid, a, b, c, gone } = await fixture();
    const d = await all(bid);
    const rows = d.transactions as Json[];
    expect(rows.map((r) => r.id)).not.toContain(gone);
    expect(rows).toHaveLength(6); // three Starting Balances and three rows
    const names: Record<string, string> = { [a]: "ZZ Bravo", [b]: "ZZ Alpha", [c]: "ZZ Charlie" };
    for (const r of rows) expect(r.account_name).toBe(names[r.account_id]);
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort().reverse());
    expect(rows.some((r) => r.account_id === c)).toBe(true);
  });

  it("sorts by account in both directions like sortTransactions", async () => {
    const { bid } = await fixture();
    const base = (await all(bid)).transactions as Json[];
    for (const dir of ["asc", "desc"] as const) {
      const d = await all(bid, `?sort=account&dir=${dir}`);
      expect(d.transactions.map((r: Json) => r.id)).toEqual(
        sortTransactions(base, "account", dir).map((r) => r.id),
      );
    }
  });

  it("since_date limits the rows, not the balances; balances equal the summary", async () => {
    const { bid } = await fixture();
    const d = await all(bid, "?since_date=2026-11-09");
    expect(d.transactions.every((r: Json) => r.date >= "2026-11-09")).toBe(true);
    expect(d.transactions.length).toBeLessThan(6);
    const sum = ((await (await json(`/api/v1/budgets/${bid}/account-summary`)).json()) as Json).data
      .balances;
    expect(d.balances).toEqual(sum);
    // Checking 250000 - 1000, Asset 5000000 + 2000; the closed Savings account is left out.
    expect(sum).toEqual({ cleared: 5252000, uncleared: -1000, working: 5251000 });
  });

  it("MCP list_transactions without account_id equals REST", async () => {
    const { bid } = await fixture();
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const m = (
      await mcpRpc("tools/call", { name: "list_transactions", arguments: { budget_id: bid } }, 2)
    ).body as Json;
    expect(m.result.structuredContent).toEqual(await all(bid));
  });

  it("answers 404 for an unknown plan and 422 for a bad sort", async () => {
    const bid = await plan();
    expect((await json(`/api/v1/budgets/${crypto.randomUUID()}/transactions`)).status).toBe(404);
    expect((await json(`/api/v1/budgets/${bid}/transactions?sort=bogus`)).status).toBe(422);
  });
});
