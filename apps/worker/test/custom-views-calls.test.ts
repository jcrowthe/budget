import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  createView,
  deleteView,
  getViewScope,
  listViews,
  reorderViews,
  updateView,
} from "../src/services/custom-views";
import { getPlanMonth } from "../src/services/months";
import { actor } from "./bulk-helpers";
import { NOV, seedPlan, TODAY } from "./plan-fixtures";

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

/** A plan with `cats` categories and `views` views of `cats` categories each, seeded in a few statements. */
async function world(cats: number, views: number) {
  const s = await seedPlan(Array.from({ length: cats }, (_, i) => `ZZ Cat ${i}`));
  const ids = Object.values(s.ids);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
     insert into plan_views (id, budget_id, builtin_key, name, category_ids, sort_order, created_at, updated_at)
     select ? || ':v' || i, ?, null, 'ZZ View ' || i, ?, i - 1, ?, ? from n`,
  )
    .bind(views, s.bid, s.bid, JSON.stringify(ids), now, now)
    .run();
  return { bid: s.bid, ids };
}

async function calls(run: (e: Env) => Promise<unknown>) {
  const c = counting();
  await run(c.env);
  return c.calls();
}

const BUILTINS = ["underfunded", "overfunded", "money_available", "snoozed"];

describe("custom views: D1 calls are constant (EXF-502)", () => {
  it("every operation costs the same for 10 views of 10 categories and 100 of 100", async () => {
    const small = await world(10, 10);
    const big = await world(100, 100);
    const both = async (
      name: string,
      expected: number,
      run: (w: typeof small, e: Env) => Promise<unknown>,
    ) => {
      const a = await calls((e) => run(small, e));
      const b = await calls((e) => run(big, e));
      expect([name, a, b]).toEqual([name, expected, expected]);
    };
    await both("list", 1, (w, e) => listViews(e, w.bid));
    await both("create", 2, (w, e) =>
      createView(e, actor, w.bid, { name: "ZZ new", category_ids: w.ids }),
    );
    await both("update", 2, (w, e) =>
      updateView(e, actor, w.bid, `${w.bid}:v1`, { name: "ZZ renamed", category_ids: w.ids }),
    );
    await both("reorder", 2, async (w, e) => {
      const l = await listViews(env as Env, w.bid);
      return reorderViews(e, actor, w.bid, { ids: [...l.order].reverse() });
    });
    await both("view scope", 1, (w, e) => getViewScope(e, w.bid, `${w.bid}:v2`));
    await both("delete", 2, (w, e) => deleteView(e, actor, w.bid, `${w.bid}:v3`));
  });

  it("create with 10 and with 100 category_ids costs the same", async () => {
    const big = await world(100, 3);
    const ten = await calls((e) =>
      createView(e, actor, big.bid, { name: "ZZ ten", category_ids: big.ids.slice(0, 10) }),
    );
    const hundred = await calls((e) =>
      createView(e, actor, big.bid, { name: "ZZ 100", category_ids: big.ids }),
    );
    expect([ten, hundred]).toEqual([2, 2]);
  });

  it("a month read with view_id costs exactly one call more", async () => {
    const small = await world(10, 10);
    const big = await world(100, 100);
    const costs: number[] = [];
    for (const w of [small, big]) {
      const plain = await calls((e) => getPlanMonth(e, w.bid, NOV, TODAY));
      const withView = await calls(async (e) =>
        getPlanMonth(e, w.bid, NOV, TODAY, await getViewScope(e, w.bid, `${w.bid}:v1`)),
      );
      expect(withView).toBe(plain + 1);
      costs.push(withView);
    }
    expect(costs[0]).toBe(costs[1]);
  });
});
