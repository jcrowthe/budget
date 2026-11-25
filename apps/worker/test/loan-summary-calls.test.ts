import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { pairLoanCategory } from "../src/services/loan-pairing";
import { getLoanSummary } from "../src/services/loan-summary";
import { account } from "./bulk-helpers";
import { actor, MORTGAGE, makeCategory, newPlan, openAccount } from "./loan-world";

// EXF-541: the summary read and the pairing write make a fixed number of D1 calls, whatever the history.

/** `env` whose database counts each executed statement and each batch as one call. */
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

/** `months` months x `perMonth` payments from `from`, in one statement. */
async function seedPayments(
  b: string,
  loan: string,
  from: string,
  months: number,
  perMonth: number,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 0 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, transfer_account_id)
     select 'zz-' || hex(randomblob(8)), ?, ?, date('2024-01-15', '+' || (i / ?) || ' months'), 1000, 'cleared', 1, ?, ?, 0, ?
     from s`,
  )
    .bind(months * perMonth - 1, b, loan, perMonth, now, now, from)
    .run();
}

async function loanWorld(paired: boolean) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (
    await openAccount(b, {
      ...MORTGAGE,
      date: "2024-01-01",
      ...(paired ? { new_category: { name: "ZZ Pay", new_group_name: "ZZ Loans" } } : {}),
    })
  ).id as string;
  return { b, checking, loan };
}

describe("summary and pairing: constant D1 calls", () => {
  for (const paired of [false, true]) {
    it(`summary (${paired ? "paired" : "unpaired"}): 10 vs 100 payments, 1 vs 24 months`, async () => {
      const measure = async (months: number, perMonth: number) => {
        const w = await loanWorld(paired);
        await seedPayments(w.b, w.loan, w.checking, months, perMonth);
        return calls((e) => getLoanSummary(e, w.b, w.loan, "2024-01-01"));
      };
      const one = await measure(1, 10);
      expect(await measure(1, 100)).toBe(one);
      expect(await measure(24, 1)).toBe(one);
      expect(await measure(1, 1)).toBe(one);
    });
  }
  it("pairing: the same count whatever the history", async () => {
    const measure = async (n: number) => {
      const w = await loanWorld(false);
      await seedPayments(w.b, w.loan, w.checking, 1, n);
      const made = await makeCategory(w.b);
      return calls((e) => pairLoanCategory(e, actor, w.b, w.loan, { category_id: made.id }));
    };
    expect(await measure(100)).toBe(await measure(10));
  });
});
