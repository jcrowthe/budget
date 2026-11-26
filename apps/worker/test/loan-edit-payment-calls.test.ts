import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { getLoanActivity } from "../src/services/loan-activity";
import { deleteLoanActivity, updateLoanActivity } from "../src/services/loan-manage-activity";
import { recordLoanPayment } from "../src/services/loan-payments";
import { account } from "./bulk-helpers";
import { actor, MORTGAGE, newPlan, openAccount } from "./loan-world";

// Loan payments: PATCH and DELETE on a payment make a fixed number of D1 calls (plan, account, one read batch,
// one write batch; a refusal stops after the read batch), whatever the history.

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

/** `months` months x `perMonth` payments from 2024-01, in one statement. */
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

const SIZES = [
  [1, 10],
  [1, 100],
  [24, 1],
] as const;

async function world(months: number, perMonth: number) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, months, perMonth);
  const res = await recordLoanPayment(env, actor, b, loan, {
    from_account_id: checking,
    amount: 5000,
    date: "2024-01-20",
  });
  return { b, loan, checking, id: res.to_transaction.id as string };
}

const run = {
  amount: (e: Env, w: Awaited<ReturnType<typeof world>>) =>
    updateLoanActivity(e, actor, w.b, w.loan, w.id, { amount: 7000 }),
  date: (e: Env, w: Awaited<ReturnType<typeof world>>) =>
    updateLoanActivity(e, actor, w.b, w.loan, w.id, { date: "2023-12-20" }),
  delete: (e: Env, w: Awaited<ReturnType<typeof world>>) =>
    deleteLoanActivity(e, actor, w.b, w.loan, w.id),
};

describe("loan payment edit and delete: constant D1 calls", () => {
  for (const [name, fn] of Object.entries(run)) {
    it(`${name} is 4 calls, whatever the history`, async () => {
      for (const [months, per] of SIZES) {
        const w = await world(months, per);
        const c = counting();
        const res = await fn(c.env, w);
        expect(res.kind).toBe("payment");
        expect(c.calls()).toBe(4);
      }
    });
  }
  it("a reconciled side refuses after the read batch: 3 calls", async () => {
    const w = await world(24, 1);
    await env.DB.prepare(
      "update transactions set cleared = 'reconciled' where transfer_transaction_id = ?",
    )
      .bind(w.id)
      .run();
    for (const fn of Object.values(run)) {
      const c = counting();
      await expect(fn(c.env, w)).rejects.toMatchObject({ status: 409, code: "reconciled_line" });
      expect(c.calls()).toBe(3);
    }
  });
  it("the Activity read stays 3 calls with 10 or 100 payments", async () => {
    for (const per of [10, 100]) {
      const w = await world(1, per);
      const c = counting();
      await getLoanActivity(c.env, w.b, w.loan, "2024-01-01");
      expect(c.calls()).toBe(3);
    }
  });
});
