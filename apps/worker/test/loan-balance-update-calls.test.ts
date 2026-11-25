import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { updateLoanBalance } from "../src/services/loan-balance-update";
import { account } from "./bulk-helpers";
import { accountOf } from "./loan-update-world";
import { actor, MORTGAGE, newPlan, openAccount } from "./loan-world";

// EXF-543: the Update Balance write makes a fixed number of D1 calls, whatever the history.

/** `env` whose database counts each executed statement and each batch as one call, and records batch sizes. */
function counting(): { env: Env; calls: () => number; batches: number[] } {
  let n = 0;
  const batches: number[] = [];
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
          batches.push(list.length);
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, batches };
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

const TODAY = "2030-01-15";

async function measure(
  months: number,
  perMonth: number,
  o: { preview?: boolean; adjust?: number; second?: boolean } = {},
) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, months, perMonth);
  const cur = (await accountOf(b, loan)).balance as number;
  if (o.second) await updateLoanBalance(env, actor, b, loan, { balance: cur, today: TODAY });
  const c = counting();
  const res = await updateLoanBalance(c.env, actor, b, loan, {
    balance: cur + (o.adjust ?? 0),
    today: TODAY,
    preview: o.preview ?? false,
  });
  expect(res.adjustment_amount).toBe(o.adjust ?? 0);
  return { calls: c.calls(), batches: c.batches };
}

describe("update balance: constant D1 calls", () => {
  it("a preview makes 3 calls, a write 4, whatever the history", async () => {
    for (const [preview, expected] of [
      [true, 3],
      [false, 4],
    ] as const) {
      for (const [months, per] of [
        [1, 10],
        [1, 100],
        [24, 1],
        [1, 1],
      ] as const) {
        expect((await measure(months, per, { preview })).calls).toBe(expected);
      }
    }
  });
  it("the same with an adjustment, and for a first or a later update", async () => {
    expect((await measure(24, 1, { adjust: 5000 })).calls).toBe(4);
    expect((await measure(1, 10, { adjust: 5000 })).calls).toBe(4);
    expect((await measure(24, 1, { second: true })).calls).toBe(4);
    expect((await measure(24, 1, { second: true, adjust: 5000 })).calls).toBe(4);
    expect((await measure(24, 1, { preview: true, adjust: 5000 })).calls).toBe(3);
  });
  it("the write batch has the same number of statements for 1 and 24 months", async () => {
    const one = await measure(1, 10, { adjust: 5000 });
    const many = await measure(24, 1, { adjust: 5000 });
    expect(many.batches.at(-1)).toBe(one.batches.at(-1));
  });
});
