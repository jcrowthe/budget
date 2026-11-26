import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  bulkScheduled,
  createScheduled,
  enterDue,
  listScheduled,
  updateScheduled,
} from "../src/services/scheduled-transactions";
import { actor, category } from "./bulk-helpers";
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

/** `n` split schedules (3 lines each) on `a`, plus `n` plain ones, inserted by SQL. */
async function insertSplits(
  budgetId: string,
  a: string,
  cats: string[],
  n: number,
  due: string,
  plainToo: boolean,
) {
  const now = new Date().toISOString();
  const parent =
    "insert into scheduled_transactions (id, budget_id, account_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, ?, 'monthly', ?, 0, ?, ?, ?)";
  const line =
    "insert into scheduled_subtransactions (id, budget_id, scheduled_transaction_id, amount, category_id, inflow_to_ready_to_assign, memo, sort, created_at, updated_at) values (?, ?, ?, -100, ?, 0, 'ZZ-TEST l', ?, ?, ?)";
  const ids: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    stmts.push(
      env.DB.prepare(parent).bind(id, budgetId, a, due, due, -300, crypto.randomUUID(), now, now),
    );
    for (let k = 0; k < 3; k++) {
      stmts.push(
        env.DB.prepare(line).bind(
          crypto.randomUUID(),
          budgetId,
          id,
          cats[k % cats.length],
          k,
          now,
          now,
        ),
      );
    }
    if (plainToo)
      stmts.push(
        env.DB.prepare(parent).bind(
          crypto.randomUUID(),
          budgetId,
          a,
          due,
          due,
          -5,
          crypto.randomUUID(),
          now,
          now,
        ),
      );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return ids;
}

async function world(n: number, due: string, plainToo = true) {
  const b = await plan();
  const a = await account(b);
  const cats = [await category(b, "Groceries"), await category(b, "Transportation")];
  const ids = await insertSplits(b, a, cats, n, due, plainToo);
  return { b, a, cats, ids };
}

describe("scheduled splits: D1 calls", () => {
  it("an account's scheduled list makes the same calls for 10 and 100 split schedules", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, a } = await world(n, "2026-12-01");
      const c = counting();
      const list = await listScheduled(c.env, b, { accountId: a });
      expect(list.filter((r) => r.subtransactions.length === 3)).toHaveLength(n);
      expect(list).toHaveLength(2 * n);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBeLessThanOrEqual(3);
  });

  it("enter-due makes 2 calls for 10 and for 100 due split schedules", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, a } = await world(n, "2026-11-16", false);
      const c = counting();
      const r = await enterDue(c.env, { budgetIds: [b], day: "2026-11-16", actor });
      expect(r.entered).toHaveLength(n);
      const rows = await q(
        "select count(*) n from transactions where budget_id = ? and account_id = ? and parent_transaction_id is not null and deleted_at is null",
        b,
        a,
      );
      expect(rows[0].n).toBe(3 * n);
      out.push(c.calls());
    }
    expect(out).toEqual([2, 2]);
  });

  it("bulk enter now makes the same calls for 10 and 100 split ids", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, ids } = await world(n, "2026-12-01");
      const c = counting();
      const r = await bulkScheduled(c.env, actor, b, { op: "enter_now", ids }, TODAY);
      expect(r.results).toHaveLength(n);
      expect(r.results[0]?.transaction?.subtransactions).toHaveLength(3);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out).toEqual([5, 5]);
  });

  it("create and edit: calls grow only with the lines (one read each, as the register's)", async () => {
    const { b, a, cats } = await world(1, "2026-12-01");
    const lines = (k: number) =>
      Array.from({ length: k }, () => ({ amount: -100, category_id: cats[0] as string }));
    const create = async (k: number) => {
      const c = counting();
      await createScheduled(
        c.env,
        actor,
        b,
        {
          account_id: a,
          date_first: "2026-12-05",
          frequency: "monthly",
          amount: -100 * k,
          subtransactions: lines(k),
        },
        TODAY,
      );
      return c.calls();
    };
    const two = await create(2);
    const ten = await create(10);
    // validateLines reads each line's category once; the rest is constant.
    expect(ten - two).toBe(8);
    expect(two).toBe(7);
    const made = await listScheduled(env, b, { accountId: a });
    const id = made.find((x) => x.subtransactions.length === 2)?.id as string;
    const edit = async (k: number) => {
      const c = counting();
      await updateScheduled(
        c.env,
        actor,
        b,
        id,
        { amount: -100 * k, subtransactions: lines(k) },
        TODAY,
      );
      return c.calls();
    };
    const e2 = await edit(2);
    const e10 = await edit(10);
    expect(e10 - e2).toBe(8);
  });
});
