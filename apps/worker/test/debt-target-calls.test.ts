import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { getMonthCategory } from "../src/services/month-categories";
import { getPlanMonth } from "../src/services/months";
import { setDebtPaymentTarget } from "../src/services/targets";
import { account, actor, type Json, plan, send } from "./bulk-helpers";

// EXF-545: the Debt Payment Target write and the month read's paired-loan figures make a fixed number of D1
// calls, whatever the number of categories, loans and payments ("Services: D1 calls" in docs/conventions.md).

const NOV = "2026-11-01";
const SETUP_TIMEOUT_MS = 60_000;

/** `env` whose database counts each executed statement and each batch as one call (and the batches). */
function counting(): { env: Env; calls: () => number; batches: () => number } {
  let n = 0;
  let b = 0;
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
          b += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, batches: () => b };
}

/** A plan with `n` ordinary categories and `n` paired loans, each with `payments` payments in November. */
async function world(n: number, payments: number) {
  const b = await plan();
  const checking = await account(b, "checking", 100000000);
  const g = await createCategoryGroup(env, actor, { budget_id: b, name: "ZZ-TEST Group" });
  for (let i = 0; i < n; i++) {
    await createCategory(env, actor, { budget_id: b, group_id: g.id, name: `ZZ-TEST Cat ${i}` });
  }
  let first = "";
  for (let i = 0; i < n; i++) {
    const res = await send(`/api/v1/budgets/${b}/accounts`, "POST", {
      name: `ZZ-TEST Loan ${i}`,
      type: "mortgage",
      balance: 200000000,
      interest_rate: "6",
      minimum_payment: 1500000,
      date: "2026-11-01",
      new_category: { name: `ZZ-TEST Pay ${i}`, group_id: g.id },
    });
    expect(res.status).toBe(201);
    const a = ((await res.json()) as Json).data.account;
    if (i === 0) first = a.paired_category_id;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `with recursive s(i) as (select 0 union all select i + 1 from s where i < ?)
       insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, transfer_account_id)
       select 'zz-' || hex(randomblob(8)), ?, ?, '2026-11-15', 1000, 'cleared', 1, ?, ?, 0, ? from s`,
    )
      .bind(payments - 1, b, a.id, now, now, checking)
      .run();
  }
  return { b, first };
}

describe("debt target: constant D1 calls", { timeout: SETUP_TIMEOUT_MS }, () => {
  it("setDebtPaymentTarget: 10 vs 100 categories and loans, one batch", async () => {
    const measure = async (n: number) => {
      const w = await world(n, 1);
      const c = counting();
      await setDebtPaymentTarget(c.env, actor, {
        budget_id: w.b,
        category_id: w.first,
        type: "debt_payment",
        amount: 1500000,
        day: "last",
      });
      return { calls: c.calls(), batches: c.batches() };
    };
    const small = await measure(10);
    const large = await measure(100);
    expect(large).toEqual(small);
    expect(small.batches).toBe(1);
  });
  it("getPlanMonth: 10 vs 100 paired loans with 3 payments each, 11 calls", async () => {
    const measure = async (n: number) => {
      const w = await world(n, 3);
      const c = counting();
      await getPlanMonth(c.env, w.b, NOV);
      const month = c.calls();
      const one = counting();
      await getMonthCategory(one.env, w.b, NOV, w.first);
      return { month, one: one.calls() };
    };
    const small = await measure(10);
    expect(await measure(100)).toEqual(small);
    expect(small).toEqual({ month: 11, one: 11 });
  });
});
