import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listAccountTransactions } from "../src/services/transactions";
import {
  getAccountViewSettings,
  getAllAccountsViewSettings,
  updateAccountViewSettings,
  updateAllAccountsViewSettings,
} from "../src/services/view-settings";
import { account, actor, plan } from "./bulk-helpers";

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

describe("view settings and the running balance: D1 calls (EXF-529)", () => {
  it("reads and writes make a fixed number of calls", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    expect(await calls((e) => getAccountViewSettings(e, b, a))).toBe(3);
    expect(await calls((e) => getAllAccountsViewSettings(e, b))).toBe(2);
    expect(
      await calls((e) => updateAccountViewSettings(e, actor, b, a, { show_flags: false })),
    ).toBe(4);
    expect(
      await calls((e) => updateAllAccountsViewSettings(e, actor, b, { show_flags: false })),
    ).toBe(3);
  });

  it("the account list with include=running_balance makes 5 calls for 10 and for 1,000 rows", async () => {
    const small = await plan();
    const sa = await account(small, "checking", 0);
    await seedRows(small, sa, 10);
    const large = await plan();
    const la = await account(large, "checking", 0);
    await seedRows(large, la, 1000);
    const withBalance = (b: string, a: string) =>
      calls((e) => listAccountTransactions(e, b, a, { include: "running_balance" }));
    const plain = (b: string, a: string) => calls((e) => listAccountTransactions(e, b, a));
    const [s, l] = [await withBalance(small, sa), await withBalance(large, la)];
    expect(s).toBe(5);
    expect(l).toBe(s);
    expect(await plain(small, sa)).toBe(5);
    expect(await plain(large, la)).toBe(5);
    const rows = (await listAccountTransactions(env, large, la, { include: "running_balance" }))
      .transactions;
    expect(rows).toHaveLength(1001); // 1,000 rows and the Starting Balance
    expect(Math.min(...rows.map((r) => r.running_balance as number))).toBe(-1000 * 1000);
  }, 120000);
});
