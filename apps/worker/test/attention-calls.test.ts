import { env } from "cloudflare:test";
import { attentionTotal, needsAttention } from "@budget/schema/attention";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { getAccount, listAccounts } from "../src/services/accounts";
import { listAccountTransactions, listPlanTransactions } from "../src/services/transactions";
import { account, category, plan, tx } from "./bulk-helpers";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
function counting(): { env: Env; calls: () => number } {
  let n = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "run" || k === "all" || k === "first" || k === "raw") {
          return (...a: unknown[]) => {
            n += 1;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    real.set(proxy, st);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "prepare") return (q: string) => wrap(t.prepare(q));
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          n += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n };
}

/** `n` rows in one statement (a recursive CTE), so seeding does not depend on `n`. */
async function seedRows(b: string, a: string, n: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 1 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign)
     select 'zz-' || hex(randomblob(8)), ?, ?, '2026-11-10', -1000, 'cleared', 1, ?, ?, 0 from s`,
  )
    .bind(n, b, a, now, now)
    .run();
}

async function calls(run: (e: Env) => Promise<unknown>) {
  const c = counting();
  await run(c.env);
  return c.calls();
}

describe("what needs attention (EXF-463)", () => {
  it("the helper, ?needs= and the account's count pick the same rows", async () => {
    const b = await plan();
    const on = await account(b, "checking", 0);
    const off = await account(b, "otherAsset", 0);
    const cat = await category(b);
    const add = (account_id: string, extra: Record<string, unknown> = {}) =>
      tx(b, { account_id, date: "2026-11-10", amount: -1000, payee_name: "ZZ P", ...extra });
    await add(on, { category_id: cat, approved: false });
    await add(on, { category_id: cat });
    await add(on);
    await add(on, { inflow_to_ready_to_assign: true, amount: 1000 });
    await add(on, {
      subtransactions: [
        { amount: -400, category_id: cat },
        { amount: -600, category_id: null },
      ],
    });
    await tx(b, { account_id: on, date: "2026-11-10", amount: -1000, transfer_account_id: off });
    await add(off);
    await add(off, { approved: false });
    const accounts = await listAccounts(env, b);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const picks = async (needs?: "approval_or_category") => {
      const all = await listPlanTransactions(env, b, needs ? { needs } : {});
      return all.transactions;
    };
    const full = await picks();
    const expected = full
      .filter((t) =>
        needsAttention(
          t,
          byId.get(t.account_id) ?? { on_budget: true },
          t.transfer_account_id ? (byId.get(t.transfer_account_id) ?? null) : null,
        ),
      )
      .map((t) => t.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect((await picks("approval_or_category")).map((t) => t.id).sort()).toEqual(expected);
    expect(attentionTotal(accounts)).toBe(expected.length);
    for (const a of [on, off]) {
      const mine = (await listAccountTransactions(env, b, a, { needs: "approval_or_category" }))
        .transactions;
      expect(mine.length).toBe((await getAccount(env, b, a)).needs_attention_count);
    }
  });

  it("the reads the screens make cost the same number of D1 calls for 10 and 100 rows", async () => {
    const measure = async (n: number) => {
      const b = await plan();
      const a = await account(b, "checking", 0);
      await seedRows(b, a, n);
      return {
        list: await calls((e) => listAccountTransactions(e, b, a, { include: "running_balance" })),
        needs: await calls((e) =>
          listAccountTransactions(e, b, a, {
            include: "running_balance",
            needs: "approval_or_category",
          }),
        ),
        plan: await calls((e) => listPlanTransactions(e, b)),
        planNeeds: await calls((e) =>
          listPlanTransactions(e, b, { needs: "approval_or_category" }),
        ),
        accounts: await calls((e) => listAccounts(e, b)),
        one: await calls((e) => getAccount(e, b, a)),
      };
    };
    const small = await measure(10);
    expect(await measure(100)).toEqual(small);
    expect(small).toEqual({ list: 5, needs: 5, plan: 4, planNeeds: 4, accounts: 5, one: 5 });
  });
});
