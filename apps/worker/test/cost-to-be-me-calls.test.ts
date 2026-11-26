import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { getMonthSummary, getPlanMonth } from "../src/services/months";
import { setTarget } from "../src/services/targets";
import { actor, plan } from "./category-helpers";

// EXF-525: the month summary's D1 calls do not grow with the categories that have targets.

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

const KINDS = [
  { cadence: "monthly", behavior: "set_aside", amount: 10000 },
  { cadence: "weekly", behavior: "set_aside", amount: 5000, day_of_week: 6 },
  { cadence: "yearly", behavior: "set_aside", amount: 120000, due_date: "2027-10-31" },
  { cadence: "custom", behavior: "balance", amount: 60000, due_month: "2027-04-01" },
] as const;

async function world(nCats: number) {
  const bid = await plan();
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ-TEST Group" });
  let expected = 0;
  for (let i = 0; i < nCats; i++) {
    const id = (
      await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: `ZZ-TEST ${i}` })
    ).id;
    const k = KINDS[i % KINDS.length];
    await setTarget(env, actor, { budget_id: bid, category_id: id, ...k } as never, {
      today: TODAY,
    });
    expected += [10000, 20000, 10000, 10000][i % KINDS.length] ?? 0;
  }
  return { bid, expected };
}

describe("cost to be me: D1 calls do not grow with categories that have targets", () => {
  it("makes the same calls for 10 and 100 categories, equal to getPlanMonth's", async () => {
    const seen: number[] = [];
    for (const nCats of [10, 100]) {
      const w = await world(nCats);
      const c = counting();
      const r = await getMonthSummary(c.env, w.bid, NOV, undefined, TODAY);
      seen.push(c.calls());
      expect(r.targets_total).toBe(w.expected);
      const plain = counting();
      await getPlanMonth(plain.env, w.bid, NOV, TODAY);
      expect(c.calls()).toBe(plain.calls());
    }
    expect(new Set(seen).size).toBe(1);
  });
});
