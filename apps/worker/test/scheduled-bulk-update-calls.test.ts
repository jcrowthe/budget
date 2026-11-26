import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { bulkScheduled } from "../src/services/scheduled-transactions";
import { actor } from "./bulk-helpers";
import { account, category, type Json, plan, q } from "./scheduled-helpers";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
function counting(): { env: Env; calls: () => number; reset: () => void } {
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
  return { env: { ...env, DB: db } as Env, calls: () => n, reset: () => (n = 0) };
}

/** `n` schedules inserted by SQL: plain, with 10% splits and 10% transfers when `mixed`. */
async function seed(n: number, mixed: boolean) {
  const b = await plan();
  const a = await account(b, "checking", 0);
  const s = await account(b, "savings", 0);
  const t = await account(b, "otherAsset", 0);
  const c = await category(b, "Groceries");
  const now = new Date().toISOString();
  const ids: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    const transfer = mixed && i % 10 === 1 ? (i % 20 === 1 ? s : t) : null;
    stmts.push(
      env.DB.prepare(
        "insert into scheduled_transactions (id, budget_id, account_id, transfer_account_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, '2026-12-01', '2026-12-01', 'monthly', ?, 0, ?, ?, ?)",
      ).bind(id, b, a, transfer, -100 - i, crypto.randomUUID(), now, now),
    );
    if (mixed && i % 10 === 2) {
      stmts.push(
        env.DB.prepare(
          "insert into scheduled_subtransactions (id, scheduled_transaction_id, budget_id, amount, category_id, inflow_to_ready_to_assign, sort, created_at, updated_at) values (?, ?, ?, ?, ?, 0, 0, ?, ?)",
        ).bind(crypto.randomUUID(), id, b, -100 - i, c, now, now),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { b, a, s, t, c, ids };
}

const figures: Record<string, number> = {};
const PINNED: Record<string, number> = { categorize: 4, flag: 4, memo: 4, move: 5 };

describe("scheduled bulk update: D1 calls", () => {
  for (const op of ["categorize", "flag", "memo", "move"] as const) {
    it(`${op}: the same calls for 10 and for 100 schedules`, async () => {
      const calls: number[] = [];
      for (const n of [10, 100]) {
        const w = await seed(n, op === "categorize" || op === "move");
        const value =
          op === "categorize" ? w.c : op === "flag" ? "red" : op === "memo" ? "ZZ-TEST x" : w.s;
        const c = counting();
        const r = await bulkScheduled(c.env, actor, w.b, { op, ids: w.ids, value } as never);
        expect(r.results.length).toBeGreaterThan(0);
        calls.push(c.calls());
      }
      expect(calls[0]).toBe(calls[1]);
      expect(calls[1]).toBeLessThanOrEqual(6);
      expect(calls[1]).toBe(PINNED[op]);
      figures[op] = calls[1] as number;
    });
  }

  it("a request that skips every row makes no batch call", async () => {
    const w = await seed(100, false);
    await bulkScheduled(env, actor, w.b, { op: "flag", ids: w.ids, value: "red" });
    const c = counting();
    const r = await bulkScheduled(c.env, actor, w.b, { op: "flag", ids: w.ids, value: "red" });
    expect(r.results).toEqual([]);
    expect(r.skipped).toHaveLength(100);
    expect(c.calls()).toBeLessThanOrEqual(2);
    const n = (await q("select count(*) n from change_log where budget_id = ?", w.b))[0] as Json;
    expect(n.n).toBeGreaterThan(0);
  });
});
