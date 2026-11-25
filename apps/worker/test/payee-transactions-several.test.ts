import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listPayeesTransactions } from "../src/services/payees";
import { data, send, tool } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { countingEnv } from "./plaid-sync-helpers";

const manyPayees = async (w: Awaited<ReturnType<typeof payeeWorld>>, n: number) => {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  const stmts = ids.flatMap((id, i) => [
    env.DB.prepare(
      "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).bind(id, w.bid, `ZZ M ${i}`),
    env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)",
    ).bind(crypto.randomUUID(), w.bid, w.acct, id),
  ]);
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return ids;
};

const calls = async (run: (e: Env) => Promise<unknown>) => {
  const c = countingEnv();
  await run(c.env);
  return c.calls.d1;
};

describe("Manage Payees: transactions of several payees", () => {
  it("REST = MCP: rows carry the payee name, counts add up, one payee gives its own rows", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A", { date: "2026-10-01", memo: "a1" });
    await w.tx("ZZ A", { date: "2026-10-05", memo: "a2" });
    await w.tx("ZZ B", { date: "2026-10-03", memo: "b1" });
    await w.sched("ZZ B");
    await w.tx("ZZ C");
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    const res = await send(`${P(w.bid)}/transactions?payee_ids=${a},${b}`, "GET");
    expect(res.status).toBe(200);
    const rest = await data(res);
    expect(rest.total_count).toBe(4);
    expect(rest.transactions.map((t: Json) => [t.payee_name, t.memo ?? null])).toEqual([
      ["ZZ B", null],
      ["ZZ A", "a2"],
      ["ZZ B", "b1"],
      ["ZZ A", "a1"],
    ]);
    const mcp = (await tool("list_payee_transactions", { budget_id: w.bid, payee_ids: [a, b] }))
      .structuredContent;
    expect(mcp).toEqual(rest);
    const one = await data(await send(`${P(w.bid)}/${a}/transactions`, "GET"));
    expect(one.total_count).toBe(2);
    expect(one.transactions.every((t: Json) => t.payee_name === "ZZ A")).toBe(true);
  });

  it("refusals: unknown, system, transfer and empty selections", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    const a = await w.id("ZZ A");
    const all = await w.list();
    const sys = all.find((p) => p.system).id;
    const transfer = all.find((p) => p.transfer_account_id).id;
    const get = (ids: string) => send(`${P(w.bid)}/transactions?payee_ids=${ids}`, "GET");
    expect((await get(`${a},nope`)).status).toBe(404);
    expect((await get(`${a},${sys}`)).status).toBe(403);
    expect((await get(`${a},${transfer}`)).status).toBe(403);
    expect((await get("")).status).toBe(422);
  });

  it("D1 calls are the same for 2 and for 20 payees", async () => {
    const out: number[] = [];
    for (const n of [2, 20]) {
      const w = await payeeWorld();
      const ids = await manyPayees(w, n);
      out.push(await calls((e) => listPayeesTransactions(e, w.bid, ids)));
    }
    expect(out[0]).toBe(out[1]);
  });
});
