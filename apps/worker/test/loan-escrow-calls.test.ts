import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { getLoanActivity } from "../src/services/loan-activity";
import { addLoanActivity } from "../src/services/loan-add-activity";
import { deleteLoanActivity, updateLoanActivity } from "../src/services/loan-manage-activity";
import { account } from "./bulk-helpers";
import { frozenRow } from "./loan-update-world";
import { actor, MORTGAGE, newPlan, openAccount } from "./loan-world";

// EXF-1013: Add Escrow, and PATCH and DELETE of an escrow line, make a fixed number of D1 calls whatever the
// history (same method as loan-manage-activity-calls.test.ts).

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
const MONTH = "2024-03-01";
const ADD = { kind: "escrow", amount: 350000, month: MONTH, today: TODAY } as const;
const EDIT = { amount: 400000, today: TODAY };

async function plain(months: number, perMonth: number) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, months, perMonth);
  return { b, loan };
}
/** A world whose month has `rows` open escrow rows (the first through Add Escrow, the rest seeded). */
async function withLine(months: number, perMonth: number, rows = 1) {
  const w = await plain(months, perMonth);
  const r = await addLoanActivity(env, actor, w.b, w.loan, ADD);
  for (let i = 1; i < rows; i++) {
    await frozenRow(w.b, w.loan, "loan_escrow", -1000, { cleared: "cleared", date: "2024-03-20" });
  }
  return { ...w, id: r.transaction.id };
}

const SIZES = [
  [1, 10, 1],
  [1, 100, 1],
  [24, 1, 1],
  [3, 1, 10],
] as const;

describe("escrow: constant D1 calls", () => {
  it("Add Escrow is 4 calls, whatever the history and the open rows", async () => {
    for (const [months, per, rows] of SIZES) {
      const w = await withLine(months, per, rows);
      const c = counting();
      const res = await addLoanActivity(c.env, actor, w.b, w.loan, { ...ADD, amount: 360000 });
      expect(res.kind).toBe("escrow");
      expect(c.calls()).toBe(4);
    }
  });
  it("Add Escrow on a month without a line is 4 calls", async () => {
    for (const [months, per] of [
      [1, 10],
      [1, 100],
    ] as const) {
      const w = await plain(months, per);
      const c = counting();
      await addLoanActivity(c.env, actor, w.b, w.loan, ADD);
      expect(c.calls()).toBe(4);
    }
  });
  it("PATCH and DELETE of an edited escrow line are 4 calls", async () => {
    for (const [months, per, rows] of SIZES) {
      const w = await withLine(months, per, rows);
      const c = counting();
      const res = await updateLoanActivity(c.env, actor, w.b, w.loan, w.id, EDIT);
      expect(res.kind).toBe("escrow");
      expect(c.calls()).toBe(4);
      const w2 = await withLine(months, per, rows);
      const c2 = counting();
      const gone = await deleteLoanActivity(c2.env, actor, w2.b, w2.loan, w2.id);
      expect(gone.transaction).toBeNull();
      expect(c2.calls()).toBe(4);
    }
  });
  it("a refusal stops after the read batch: 3 calls", async () => {
    const w = await plain(24, 1);
    const id = await frozenRow(w.b, w.loan, "loan_escrow", -5000, {
      cleared: "reconciled",
      date: "2024-03-15",
    });
    for (const run of [
      (e: Env) => updateLoanActivity(e, actor, w.b, w.loan, id, EDIT),
      (e: Env) => deleteLoanActivity(e, actor, w.b, w.loan, id),
    ]) {
      const c = counting();
      await expect(run(c.env)).rejects.toMatchObject({ status: 409, code: "reconciled_line" });
      expect(c.calls()).toBe(3);
    }
  });
  it("Account Activity with an edited escrow line is 3 calls", async () => {
    for (const [months, per] of [
      [1, 10],
      [1, 100],
    ] as const) {
      const w = await withLine(months, per);
      const c = counting();
      const a = await getLoanActivity(c.env, w.b, w.loan, MONTH);
      expect(a.escrow).toMatchObject({ state: "edited", editable: true });
      expect(c.calls()).toBe(3);
    }
  });
});
