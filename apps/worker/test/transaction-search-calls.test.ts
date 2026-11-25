import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
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

/** Two live split lines on every 10th row would make the seed depend on n; one split row is enough to reach the lines branch. */
async function seedSplit(b: string, a: string) {
  const now = new Date().toISOString();
  const id = `zz-split-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, payee_name)
     values (?, ?, ?, '2026-11-10', -2000, 'uncleared', 1, ?, ?, 0, 'ZZ Split Payee')`,
  )
    .bind(id, b, a, now, now)
    .run();
  for (const i of [0, 1]) {
    await env.DB.prepare(
      `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, parent_transaction_id, split_index, memo)
       values (?, ?, ?, '2026-11-10', -1000, 'uncleared', 1, ?, ?, 0, ?, ?, 'ZZ gift')`,
    )
      .bind(`${id}-${i}`, b, a, now, now, id, i)
      .run();
  }
}

const QUERIES = [
  undefined,
  "Is: Uncleared, Outflow: >=1, ZZ",
  "Memo: gift, Outflow: 10, Category: x",
];

describe("register search: D1 calls (EXF-528)", () => {
  it("cost the same for 10 and 100 rows, with and without q", async () => {
    const measure = async (n: number) => {
      const b = await plan();
      const a = await account(b, "checking", 0);
      await seedRows(b, a, n);
      await seedSplit(b, a);
      const out: Record<string, number> = {};
      for (const q of QUERIES) {
        out[`account ${q}`] = await calls((e) =>
          listAccountTransactions(e, b, a, { q, include: "running_balance" }),
        );
        out[`plan ${q}`] = await calls((e) => listPlanTransactions(e, b, { q }));
      }
      return out;
    };
    const small = await measure(10);
    expect(await measure(100)).toEqual(small);
    for (const q of QUERIES) {
      expect(small[`account ${q}`]).toBe(small["account undefined"]);
      expect(small[`plan ${q}`]).toBe(small["plan undefined"]);
    }
  });

  it("finds rows by q at 100 rows (the count is not a count of nothing)", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    await seedRows(b, a, 100);
    await seedSplit(b, a);
    const got = await listAccountTransactions(env, b, a, { q: "Memo: gift" });
    expect(got.transactions).toHaveLength(1);
    expect((await listPlanTransactions(env, b, { q: "Is: Uncleared" })).transactions).toHaveLength(
      1,
    );
  });
});
