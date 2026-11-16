import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { reconcileAccount } from "../src/services/reconcile";
import { account, actor, plan, q } from "./bulk-helpers";

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

/** `n` cleared rows of -1.00 in one statement (a recursive CTE), so seeding does not depend on `n`. */
async function seedCleared(b: string, a: string, n: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 1 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign)
     select 'zz-' || hex(randomblob(8)), ?, ?, '2026-11-10', -1000, 'cleared', 1, ?, ?, 0 from s`,
  )
    .bind(n, b, a, now, now)
    .run();
}

async function world(n: number) {
  const b = await plan();
  const a = await account(b, "checking", 0);
  await seedCleared(b, a, n);
  return { b, a, cleared: -1000 * n };
}

describe("reconcile: D1 calls do not grow with the rows (case 14)", () => {
  it("makes 6 calls without an adjustment and 7 with one, for 10 and for 1,000 cleared rows", async () => {
    const calls: Record<string, number[]> = { plain: [], adjusted: [] };
    for (const n of [10, 1000]) {
      for (const kind of ["plain", "adjusted"] as const) {
        const w = await world(n);
        const counter = counting();
        const res = await reconcileAccount(counter.env, actor, w.b, w.a, {
          statement_balance: kind === "plain" ? w.cleared : w.cleared - 5000,
          create_adjustment: kind === "adjusted",
        });
        calls[kind]?.push(counter.calls());
        expect(res.reconciled_count).toBe(n + 1); // plus the zero Starting Balance row
        expect(res.adjustment === null).toBe(kind === "plain");
        const rows = await q(
          "select count(*) n from transactions where account_id = ? and cleared = 'reconciled'",
          w.a,
        );
        expect(rows[0]?.n).toBe(n + 1 + (kind === "adjusted" ? 1 : 0));
        const logs = await q(
          "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction' and action = 'update' and json_extract(after_json, '$.cleared') = 'reconciled'",
          w.b,
        );
        expect(logs[0]?.n).toBe(n + 1);
      }
    }
    expect(calls.plain).toEqual([6, 6]);
    expect(calls.adjusted).toEqual([7, 7]);
  }, 120000);
});
