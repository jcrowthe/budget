import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { addLoanActivity } from "../src/services/loan-add-activity";
import { deleteLoanActivity, updateLoanActivity } from "../src/services/loan-manage-activity";
import { account } from "./bulk-helpers";
import { frozenRow } from "./loan-update-world";
import { actor, MORTGAGE, newPlan, openAccount } from "./loan-world";

// Loan manage: PATCH and DELETE on an activity row make a fixed number of D1 calls (plan, account, one read batch,
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

const TODAY = "2030-01-15";
const ADD = {
  interest: { kind: "interest", amount: 5000, month: "2024-03-01", today: TODAY },
  fee: { kind: "fee", amount: 5000, date: "2024-03-10", memo: "ZZ-TEST fee", today: TODAY },
  credit: { kind: "credit", amount: 5000, date: "2024-03-10", today: TODAY },
} as const;

async function world(months: number, perMonth: number, kind: keyof typeof ADD, rowsInMonth = 1) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, months, perMonth);
  let id = "";
  for (let i = 0; i < (kind === "interest" ? rowsInMonth : 1); i++) {
    const r = await addLoanActivity(env, actor, b, loan, ADD[kind]);
    id ||= r.transaction.id;
  }
  return { b, loan, id };
}

const EDIT = { amount: 7000, today: TODAY };

async function measureEdit(months: number, perMonth: number, kind: keyof typeof ADD, rows = 1) {
  const w = await world(months, perMonth, kind, rows);
  const c = counting();
  const res = await updateLoanActivity(c.env, actor, w.b, w.loan, w.id, EDIT);
  expect(res.kind).toBe(kind);
  return c.calls();
}
async function measureDelete(months: number, perMonth: number, kind: keyof typeof ADD, rows = 1) {
  const w = await world(months, perMonth, kind, rows);
  const c = counting();
  const res = await deleteLoanActivity(c.env, actor, w.b, w.loan, w.id);
  expect(res.transaction).toBeNull();
  return c.calls();
}

const SIZES = [
  [1, 10, 1],
  [1, 100, 1],
  [24, 1, 1],
  [3, 1, 10],
] as const;

describe("loan activity edit and delete: constant D1 calls", () => {
  it("edit is 4 calls for every kind, whatever the history", async () => {
    for (const kind of ["interest", "fee", "credit"] as const) {
      for (const [months, per, rows] of SIZES) {
        expect(await measureEdit(months, per, kind, rows)).toBe(4);
      }
    }
  });
  it("delete is 4 calls for every kind, whatever the history", async () => {
    for (const kind of ["interest", "fee", "credit"] as const) {
      for (const [months, per, rows] of SIZES) {
        expect(await measureDelete(months, per, kind, rows)).toBe(4);
      }
    }
  });
  it("a refusal stops after the read batch: 3 calls", async () => {
    const b = await newPlan();
    const checking = await account(b, "checking", 100000000);
    const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
    await seedPayments(b, loan, checking, 24, 1);
    const id = await frozenRow(b, loan, "loan_interest", -5000, {
      cleared: "reconciled",
      date: "2024-03-15",
    });
    for (const run of [
      (e: Env) => updateLoanActivity(e, actor, b, loan, id, EDIT),
      (e: Env) => deleteLoanActivity(e, actor, b, loan, id),
    ]) {
      const c = counting();
      await expect(run(c.env)).rejects.toMatchObject({ status: 409, code: "reconciled_line" });
      expect(c.calls()).toBe(3);
    }
  });
});
