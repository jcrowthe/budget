import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup, moveCategory } from "../src/services/categories";
import { moveCategoryGroup } from "../src/services/category-groups";
import { plan } from "./account-helpers";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
function counting(): { env: Env; calls: () => number; batches: () => number } {
  let n = 0;
  let b = 0;
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
          b += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, batches: () => b };
}

const actor = "user:tester@localhost";

/** n categories in one group, consecutive sorts (or spaced by 1000 when `spaced`). */
async function catWorld(n: number, spaced: boolean) {
  const bid = await plan();
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Group" });
  const ids: string[] = [];
  for (let i = 0; i < Math.min(n, 100); i++) {
    ids.push(
      (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: `ZZ ${i}` })).id,
    );
  }
  if (spaced) {
    await env.DB.prepare("update categories set sort_order = sort_order * 1000 where group_id = ?")
      .bind(g.id)
      .run();
  }
  return { bid, gid: g.id, ids };
}

async function groupWorld(n: number, spaced: boolean) {
  const bid = await plan();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await createCategoryGroup(env, actor, { budget_id: bid, name: `ZZ G${i}` })).id);
  }
  if (spaced) {
    await env.DB.prepare(
      "update category_groups set sort_order = sort_order * 1000 where budget_id = ?",
    )
      .bind(bid)
      .run();
  }
  return { bid, ids };
}

describe("category moves: D1 calls do not grow with the rows", () => {
  for (const [label, spaced] of [
    ["a midpoint move", true],
    ["a renormalizing move", false],
  ] as const) {
    it(`${label}: one batch, the same calls for 10 and 100`, async () => {
      const measure = async (n: number) => {
        const w = await catWorld(n, spaced);
        const c = counting();
        // the last row goes between the first two (adjacent when not spaced)
        await moveCategory(c.env, actor, {
          budget_id: w.bid,
          category_id: w.ids.at(-1) as string,
          group_id: w.gid,
          after_category_id: w.ids[0],
        });
        expect(c.batches()).toBe(1);
        return c.calls();
      };
      const [small, large] = [await measure(10), await measure(100)];
      expect(large).toBe(small);
      expect(small).toBeLessThanOrEqual(6);
    });

    it(`${label} of a group: one batch, the same calls for 10 and 100`, async () => {
      const measure = async (n: number) => {
        const w = await groupWorld(n, spaced);
        const c = counting();
        await moveCategoryGroup(c.env, actor, {
          budget_id: w.bid,
          group_id: w.ids.at(-1) as string,
          after_group_id: w.ids[0],
        });
        expect(c.batches()).toBe(1);
        return c.calls();
      };
      const [small, large] = [await measure(10), await measure(100)];
      expect(large).toBe(small);
      expect(small).toBeLessThanOrEqual(5);
    });
  }
});
