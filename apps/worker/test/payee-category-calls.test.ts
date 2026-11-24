import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listPayeeRecentTransactions, listPayees, updatePayee } from "../src/services/payees";
import { addTransaction, deleteTransaction, updateTransaction } from "../src/services/transactions";
import { data, send } from "./account-helpers";
import { type Json, payeeWorld } from "./manage-payees-helpers";
import { countingEnv, REST_ACTOR } from "./plaid-sync-helpers";

const calls = async (run: (e: Env) => Promise<unknown>) => {
  const c = countingEnv();
  await run(c.env);
  return c.calls.d1;
};

async function world() {
  const w = await payeeWorld();
  const g = (
    await data(await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ G" }))
  ).category_group as Json;
  const fun = (
    await data(
      await send(`/api/v1/budgets/${w.bid}/categories`, "POST", { group_id: g.id, name: "ZZ Fun" }),
    )
  ).category.id as string;
  return { ...w, fun };
}

describe("D1 calls with the payee category (EXF-515)", () => {
  it("the payee list: 3 calls for 10 and for 100 payees, every payee with counted rows", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const s = await world();
      const ids = Array.from({ length: n }, () => crypto.randomUUID());
      const stmts = ids.flatMap((id, i) => [
        env.DB.prepare(
          "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).bind(id, s.bid, `ZZ L ${i}`),
        env.DB.prepare(
          "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id, category_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?)",
        ).bind(crypto.randomUUID(), s.bid, s.acct, id, s.fun),
      ]);
      for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
      out.push(await calls((e) => listPayees(e, s.bid, { includeHidden: true })));
      const listed = await s.list();
      expect(
        listed.filter((p) => p.name.startsWith("ZZ L ") && p.default_category_id === s.fun),
      ).toHaveLength(n);
    }
    expect(out).toEqual([3, 3]);
  });

  it("transaction create, update and delete make the same calls as base", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.fun });
    const pid = await s.id("ZZ P");
    let id = "";
    const base = { account_id: s.acct, date: "2026-11-10", amount: -1, category_id: s.fun };
    const out = {
      addExisting: await calls(async (e) => {
        id = (await addTransaction(e, REST_ACTOR, s.bid, { ...base, payee_id: pid } as Json)).id;
      }),
      addNewPayee: await calls((e) =>
        addTransaction(e, REST_ACTOR, s.bid, { ...base, payee_name: "ZZ New" } as Json),
      ),
      updateCategory: await calls((e) =>
        updateTransaction(e, REST_ACTOR, s.bid, id, { category_id: null } as Json),
      ),
      updatePayee: await calls((e) =>
        updateTransaction(e, REST_ACTOR, s.bid, id, { payee_name: "ZZ New" } as Json),
      ),
      delete: await calls((e) => deleteTransaction(e, REST_ACTOR, s.bid, id)),
    };
    // Measured on main d1e7f2d before this change.
    expect(out).toEqual({
      addExisting: 9,
      addNewPayee: 9,
      updateCategory: 7,
      updatePayee: 8,
      delete: 5,
    });
  });

  it("PATCH payee takes at most 4 calls; recent transactions at most 3", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.fun });
    const id = await s.id("ZZ P");
    const mode = await calls((e) =>
      updatePayee(e, REST_ACTOR, s.bid, id, { category_mode: "off" }),
    );
    const fixed = await calls((e) =>
      updatePayee(e, REST_ACTOR, s.bid, id, {
        category_mode: "fixed",
        fixed_category_id: s.fun,
      }),
    );
    const both = await calls((e) =>
      updatePayee(e, REST_ACTOR, s.bid, id, {
        name: "ZZ P2",
        category_mode: "fixed",
        fixed_inflow_to_ready_to_assign: true,
      }),
    );
    expect(Math.max(mode, fixed, both)).toBeLessThanOrEqual(4);
    expect(await calls((e) => listPayeeRecentTransactions(e, s.bid, id, 3))).toBeLessThanOrEqual(3);
  });
});
