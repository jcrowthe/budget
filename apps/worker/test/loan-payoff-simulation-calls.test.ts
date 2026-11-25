import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { simulateLoanPayoff } from "../src/services/loan-payoff-simulation";
import { getLoanSummary } from "../src/services/loan-summary";
import { account } from "./bulk-helpers";
import { MORTGAGE, newPlan, openAccount } from "./loan-world";

// EXF-544 follow-up: the simulation reuses the loan summary's reads, so it makes the summary's D1 calls and no
// more, whatever the history or the typed figures.
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
async function calls(run: (e: Env) => Promise<unknown>) {
  const c = counting();
  await run(c.env);
  return c.calls();
}

async function seedPayments(b: string, loan: string, from: string, count: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 0 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, transfer_account_id)
     select 'zz-' || hex(randomblob(8)), ?, ?, date('2024-01-15', '+' || i || ' months'), 1000, 'cleared', 1, ?, ?, 0, ?
     from s`,
  )
    .bind(count - 1, b, loan, now, now, from)
    .run();
}

describe("payoff simulation: constant D1 calls", () => {
  for (const paired of [false, true]) {
    it(`${paired ? "paired" : "unpaired"}: as many calls as the summary, whatever the history`, async () => {
      const measure = async (payments: number) => {
        const b = await newPlan();
        const checking = await account(b, "checking", 100000000);
        const loan = (
          await openAccount(b, {
            ...MORTGAGE,
            date: "2024-01-01",
            ...(paired ? { new_category: { name: "ZZ Pay", new_group_name: "ZZ Loans" } } : {}),
          })
        ).id as string;
        await seedPayments(b, loan, checking, payments);
        const sim = await calls((e) =>
          simulateLoanPayoff(e, b, loan, { monthly_payment: 2000000, extra_once: 5000000 }),
        );
        const sum = await calls((e) => getLoanSummary(e, b, loan));
        return { sim, sum };
      };
      const one = await measure(1);
      const many = await measure(24);
      expect(one.sim).toBe(one.sum);
      expect(many.sim).toBe(one.sim);
    });
  }
});
