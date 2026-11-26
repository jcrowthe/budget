import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { getMonthSummary, getPlanMonth } from "../src/services/months";
import { actor, plan } from "./category-helpers";

const TODAY = "2026-11-15";
const NOV = "2026-11-01";

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

async function world(nCats: number, nFuture: number) {
  const bid = await plan();
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ-TEST Group" });
  const ids: string[] = [];
  for (let i = 0; i < nCats; i++) {
    ids.push(
      (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: `ZZ-TEST ${i}` }))
        .id,
    );
  }
  // 1000 milliunits per category per month, for the nFuture months after November 2026.
  await env.DB.prepare(
    `with recursive m(i) as (select 1 union all select i + 1 from m where i < ?)
     insert into month_categories (budget_id, month, category_id, assigned, updated_at)
     select ?, date('2026-11-01', '+' || m.i || ' months'), c.id, 1000, ?
     from m cross join categories c where c.budget_id = ? and c.group_id = ?`,
  )
    .bind(nFuture, bid, new Date().toISOString(), bid, g.id)
    .run();
  return { bid };
}

describe("future_assigned: D1 calls do not grow with categories or months", () => {
  it("makes the same calls for 10 and 100 categories and 3 and 24 future months", async () => {
    const seen: number[] = [];
    for (const [nCats, nFuture] of [
      [10, 3],
      [100, 3],
      [10, 24],
      [100, 24],
    ] as const) {
      const w = await world(nCats, nFuture);
      const c = counting();
      const r = await getMonthSummary(c.env, w.bid, NOV, undefined, TODAY);
      seen.push(c.calls());
      expect(r.future_assigned).toHaveLength(nFuture);
      expect(r.future_assigned?.[0]).toEqual({ month: "2026-12-01", assigned: 1000 * nCats });
      expect(r.future_assigned_total).toBe(1000 * nCats * nFuture);
      const plain = counting();
      await getPlanMonth(plain.env, w.bid, NOV, TODAY);
      expect(c.calls()).toBe(plain.calls());
    }
    expect(new Set(seen).size).toBe(1);
  });
});
