import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createBudget } from "../src/services/budgets";
import { freshStartBudget } from "../src/services/fresh-start";
import { actor, n, rand, T } from "./fresh-start-helpers";

/** `env` whose database counts each executed statement and each batch as one call, and records every batch's size. */
function counting(): { env: Env; calls: () => number; batches: number[] } {
  let calls = 0;
  const batches: number[] = [];
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "run" || k === "all" || k === "first" || k === "raw") {
          return (...a: unknown[]) => {
            calls += 1;
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
      if (k === "prepare") return (sql: string) => wrap(t.prepare(sql));
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          calls += 1;
          batches.push(list.length);
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => calls, batches };
}

/** A plan with `size` categories, payees, schedules (a fifth of them splits, a fifth transfers), snoozes and notes. */
async function world(size: number, accounts: number) {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${rand()}` })).id;
  const now = new Date().toISOString();
  const cte = `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)`;
  const exec = (sql: string, ...b: unknown[]) =>
    env.DB.prepare(sql)
      .bind(...b)
      .run();
  await exec(
    `${cte} insert into accounts (id, budget_id, name, type, on_budget, sort_order, created_at)
     select ? || ':a' || i, ?, 'ZZ Acct ' || i, 'checking', 1, i, ? from n`,
    accounts,
    bid,
    bid,
    now,
  );
  await exec(
    `insert into category_groups (id, budget_id, name, sort_order, created_at, updated_at) values (?, ?, 'ZZ G', 50, ?, ?)`,
    `${bid}:g`,
    bid,
    now,
    now,
  );
  await exec(
    `${cte} insert into categories (id, budget_id, group_id, name, sort_order, created_at, updated_at, note)
     select ? || ':c' || i, ?, ?, 'ZZ Cat ' || i, i, ?, ?, 'ZZ note' from n`,
    size,
    bid,
    `${bid}:g`,
    now,
    now,
  );
  await exec(
    `${cte} insert into payees (id, budget_id, name, created_at, updated_at, fixed_category_id)
     select ? || ':p' || i, ?, 'ZZ Payee ' || i, ?, ?, ? || ':c' || i from n`,
    size,
    bid,
    bid,
    now,
    now,
    bid,
  );
  await exec(
    `${cte} insert into target_snoozes (budget_id, category_id, month, created_at)
     select ?, ? || ':c' || i, '2026-04-01', ? from n`,
    size,
    bid,
    bid,
    now,
  );
  await exec(
    `${cte} insert into months (budget_id, month, note, updated_at)
     select ?, '2030-' || substr('0' || ((i - 1) % 12 + 1), -2) || '-01', 'ZZ', ? from n where i <= 12`,
    size,
    bid,
    now,
  );
  await exec(
    `${cte} insert into scheduled_transactions (id, budget_id, account_id, date_first, date_next, frequency, amount, payee_id, category_id, transfer_account_id, write_token, created_at, updated_at)
     select ? || ':s' || i, ?, ? || ':a1', '2026-03-20', '2026-03-20', 'monthly', -1000 * (i % 5 + 1), ? || ':p' || i, ? || ':c' || i,
       case when i % 5 = 1 then ? || ':a2' end, ? || ':t' || i, ?, ? from n`,
    size,
    bid,
    bid,
    bid,
    bid,
    bid,
    bid,
    now,
    now,
  );
  // every fifth schedule (not a transfer) is a split with two lines
  await exec(
    `${cte} insert into scheduled_subtransactions (id, budget_id, scheduled_transaction_id, amount, payee_id, category_id, sort, created_at, updated_at)
     select ? || ':l' || i || ':' || k, ?, ? || ':s' || i, -500 * (i % 5 + 1), ? || ':p' || i, ? || ':c' || i, k, ?, ? from n, (select 0 as k union all select 1) where i % 5 = 2`,
    size,
    bid,
    bid,
    bid,
    bid,
    now,
    now,
  );
  await exec(
    `update scheduled_transactions set category_id = null where budget_id = ? and id in (select scheduled_transaction_id from scheduled_subtransactions where budget_id = ?)`,
    bid,
    bid,
  );
  return bid;
}

async function measure(bid: string) {
  const c = counting();
  const res = await freshStartBudget(c.env, actor, bid, {
    name: `ZZ-TEST new ${rand()}`,
    stop_importing_in_archive: true,
    today: T,
  });
  return { ...res, calls: c.calls(), batches: c.batches };
}

describe("Fresh Start: D1 calls are constant (EXF-478)", () => {
  it("one read batch and one write batch whatever the plan's size", async () => {
    const small = await measure(await world(10, 3));
    const bigBid = await world(100, 10);
    const big = await measure(bigBid);
    expect(small.calls).toBeLessThanOrEqual(3);
    expect(big.calls).toBe(small.calls);
    expect(big.batches).toEqual(small.batches);
    expect(Math.max(...big.batches)).toBeLessThanOrEqual(40);
    // 100 categories (+ the default ones) and 100 schedules arrived
    expect(
      await n(
        "select count(*) n from categories where budget_id = ? and name like 'ZZ Cat %' and deleted_at is null",
        big.new_budget_id,
      ),
    ).toBe(100);
    expect(
      await n(
        "select count(*) n from scheduled_transactions where budget_id = ? and deleted_at is null",
        big.new_budget_id,
      ),
    ).toBe(100);
    expect(
      await n(
        "select count(*) n from scheduled_subtransactions where budget_id = ? and deleted_at is null",
        big.new_budget_id,
      ),
    ).toBe(40);
    expect(
      await n(
        "select count(*) n from payees where budget_id = ? and name like 'ZZ Payee %' and deleted_at is null",
        big.new_budget_id,
      ),
    ).toBe(100);
    expect(
      await n("select count(*) n from target_snoozes where budget_id = ?", big.new_budget_id),
    ).toBe(100);
    expect(
      await n(
        "select count(*) n from months where budget_id = ? and month >= '2026-03-01' and note is not null",
        big.new_budget_id,
      ),
    ).toBe(12);
    expect(
      await n("select count(*) n from transactions where budget_id = ?", big.new_budget_id),
    ).toBe(10);
  });
});
