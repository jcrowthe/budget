import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { bulkScheduled, enterDue, listScheduled } from "../src/services/scheduled-transactions";
import { actor } from "./bulk-helpers";
import { account, plan, q, TODAY } from "./scheduled-helpers";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
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
      if (k === "prepare") return (s: string) => wrap(t.prepare(s));
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

/** `n` schedules from `a` to `b` (and, with `plainToo`, `n` plain ones on `b`), inserted by SQL. */
async function insertTransfers(
  budgetId: string,
  a: string,
  b: string,
  n: number,
  due: string,
  plainToo = false,
) {
  const now = new Date().toISOString();
  const sql =
    "insert into scheduled_transactions (id, budget_id, account_id, transfer_account_id, date_first, date_next, frequency, amount, memo, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'monthly', ?, 'ZZ-TEST t', 0, ?, ?, ?)";
  const rows = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(sql).bind(
      crypto.randomUUID(),
      budgetId,
      a,
      b,
      due,
      due,
      -100 - i,
      crypto.randomUUID(),
      now,
      now,
    ),
  );
  if (plainToo) {
    for (let i = 0; i < n; i++) {
      rows.push(
        env.DB.prepare(sql).bind(
          crypto.randomUUID(),
          budgetId,
          b,
          null,
          due,
          due,
          -5 - i,
          crypto.randomUUID(),
          now,
          now,
        ),
      );
    }
  }
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
}

async function world(n: number, due: string, plainToo = false) {
  const b = await plan();
  const a = await account(b);
  const s = await account(b, "savings");
  await insertTransfers(b, a, s, n, due, plainToo);
  return { b, a, s };
}

describe("scheduled transfers: D1 calls", () => {
  it("an account's scheduled list makes the same calls for 10 and 100 transfers, mirrors included", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, s } = await world(n, "2026-12-01", true);
      const c = counting();
      const list = await listScheduled(c.env, b, { accountId: s });
      expect(list.filter((r) => r.mirror)).toHaveLength(n);
      expect(list.filter((r) => !r.mirror)).toHaveLength(n);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBeLessThanOrEqual(3);
  });

  it("enter-due makes the same calls for 10 and 100 due transfers", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, a, s } = await world(n, "2026-11-16");
      const c = counting();
      const r = await enterDue(c.env, {
        budgetIds: [b],
        day: "2026-11-16",
        actor: "service:scheduler",
      });
      expect(r.entered).toHaveLength(n);
      const rows = await q(
        "select count(*) n from transactions where budget_id = ? and account_id in (?, ?) and transfer_transaction_id is not null and deleted_at is null",
        b,
        a,
        s,
      );
      expect(rows[0].n).toBe(2 * n);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBeLessThanOrEqual(2);
  });

  it("bulk enter now makes the same calls for 10 and 100 transfer ids", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b } = await world(n, "2026-12-01");
      const ids = (await q("select id from scheduled_transactions where budget_id = ?", b)).map(
        (r) => r.id as string,
      );
      const c = counting();
      const r = await bulkScheduled(c.env, actor, b, { op: "enter_now", ids }, TODAY);
      expect(r.results).toHaveLength(n);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBeLessThanOrEqual(5);
  });
});
