import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { addLoanActivity } from "../src/services/loan-add-activity";
import { account } from "./bulk-helpers";
import { actor, MORTGAGE, newPlan, openAccount } from "./loan-world";

// EXF-542: Add Activity makes a fixed number of D1 calls (plan, account, read batch, write batch), whatever the history.

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

const TODAY = "2030-01-15";
const BODIES = {
  interest: { kind: "interest", amount: 5000, month: "2024-03-01", today: TODAY },
  fee: { kind: "fee", amount: 5000, memo: "ZZ-TEST fee", today: TODAY },
  credit: { kind: "credit", amount: 5000, today: TODAY },
} as const;

async function measure(
  months: number,
  perMonth: number,
  kind: keyof typeof BODIES,
  second = false,
) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, months, perMonth);
  if (second) await addLoanActivity(env, actor, b, loan, BODIES[kind]);
  const c = counting();
  const res = await addLoanActivity(c.env, actor, b, loan, BODIES[kind]);
  expect(res.kind).toBe(kind);
  return c.calls();
}

describe("add loan activity: constant D1 calls", () => {
  it("4 calls for every kind, whatever the history", async () => {
    for (const kind of ["interest", "fee", "credit"] as const) {
      for (const [months, per] of [
        [1, 10],
        [1, 100],
        [24, 1],
        [3, 1],
      ] as const) {
        expect(await measure(months, per, kind)).toBe(4);
      }
    }
  });
  it("the same for a first or a later interest", async () => {
    expect(await measure(24, 1, "interest", true)).toBe(4);
    expect(await measure(1, 10, "interest", true)).toBe(4);
    expect(await measure(1, 10, "interest")).toBe(4);
  });
});
