import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { listCategoryActivity } from "../src/services/category-activity";
import { account, plan } from "./account-helpers";

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

async function world(n: number) {
  const bid = await plan();
  const a = await account(bid, "checking", 0);
  const g = await createCategoryGroup(env, "user:tester@localhost", {
    budget_id: bid,
    name: "ZZ Group",
  });
  const cat = (
    await createCategory(env, "user:tester@localhost", {
      budget_id: bid,
      group_id: g.id,
      name: "ZZ Food",
    })
  ).id;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 1 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, category_id, amount, cleared, approved, inflow_to_ready_to_assign, created_at, updated_at)
     select 'zz-' || hex(randomblob(8)), ?, ?, '2026-11-10', ?, -1000, 'uncleared', 1, 0, ?, ? from s`,
  )
    .bind(n, bid, a.id, cat, now, now)
    .run();
  return { bid, cat };
}

describe("category activity: D1 calls do not grow with the rows", () => {
  it("makes 3 calls for 10 and for 100 transactions", async () => {
    const seen: number[] = [];
    for (const n of [10, 100]) {
      const w = await world(n);
      const c = counting();
      const r = await listCategoryActivity(c.env, w.bid, "2026-11-01", w.cat);
      expect(r.total_count).toBe(n);
      seen.push(c.calls());
    }
    expect(seen).toEqual([3, 3]);
  });
});
