import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { getAccount, getAccountSummary, listAccounts } from "../src/services/accounts";
import { getLoanActivity } from "../src/services/loan-activity";
import { payAccount } from "../src/services/loan-payments";
import { getNetWorth } from "../src/services/reports";
import { account, type Json, plan, send } from "./bulk-helpers";

// EXF-540: the loan reads and the payment write make a fixed number of D1 calls, whatever the history.
const actor = "user:tester@localhost";

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

async function loanWorld() {
  const b = await plan();
  const checking = await account(b, "checking", 100000000);
  const res = await send(`/api/v1/budgets/${b}/accounts`, "POST", {
    name: `ZZ Loan ${crypto.randomUUID().slice(0, 8)}`,
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    escrow_amount: 300000,
    date: "2024-01-01",
    new_category: { name: "ZZ Pay", new_group_name: "ZZ Loans" },
  });
  expect(res.status).toBe(201);
  const loan = ((await res.json()) as Json).data.account.id as string;
  return { b, checking, loan };
}

describe("loan reads and writes: constant D1 calls", () => {
  it("activity: 1 vs 12 months, 10 vs 100 payments in the month", async () => {
    const measure = async (months: number, perMonth: number) => {
      const w = await loanWorld();
      await seedPayments(w.b, w.loan, w.checking, months, perMonth);
      return calls((e) => getLoanActivity(e, w.b, w.loan, "2024-01-01"));
    };
    const one = await measure(1, 1);
    expect(await measure(12, 1)).toBe(one);
    expect(await measure(1, 10)).toBe(one);
    expect(await measure(1, 100)).toBe(one);
    expect(one).toBe(3);
  });
  it("record payment: 10 vs 100 earlier payments, with and without amount", async () => {
    const measure = async (n: number, withAmount: boolean) => {
      const w = await loanWorld();
      await seedPayments(w.b, w.loan, w.checking, 1, n);
      return calls((e) =>
        payAccount(e, actor, w.b, w.loan, {
          from_account_id: w.checking,
          date: "2024-01-20",
          ...(withAmount ? { amount: 1500000 } : {}),
        }).catch((err) => {
          if (withAmount) throw err; // nothing assigned: the default refuses after the same reads
        }),
      );
    };
    expect(await measure(100, true)).toBe(await measure(10, true));
    expect(await measure(100, false)).toBe(await measure(10, false));
  });
  it("account list, get, summary and net worth: 1 vs 12 months", async () => {
    const measure = async (months: number) => {
      const w = await loanWorld();
      await seedPayments(w.b, w.loan, w.checking, months, 1);
      return {
        list: await calls((e) => listAccounts(e, w.b)),
        one: await calls((e) => getAccount(e, w.b, w.loan)),
        summary: await calls((e) => getAccountSummary(e, w.b)),
        net: await calls((e) =>
          getNetWorth(e, w.b, { start_month: "2024-01-01", end_month: "2024-12-01" } as never),
        ),
      };
    };
    const small = await measure(1);
    expect(await measure(12)).toEqual(small);
  });
});
