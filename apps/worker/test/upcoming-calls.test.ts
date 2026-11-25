import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { tools } from "../src/mcp/tools/scheduled-transactions";
import { previewAutoAssign } from "../src/services/auto-assign";
import { getMonthCategory } from "../src/services/month-categories";
import { getPlanMonth } from "../src/services/months";
import { listUpcomingForCategory } from "../src/services/scheduled-transactions";
import { account, category, plan } from "./scheduled-helpers";

// EXF-505: the upcoming reads add one set query, the schedules, so their D1 calls do not grow with the number
// of schedules (10 against 100 on one category).
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

const NOV = "2026-11-01";

/** `n` schedules on one category, inserted by SQL in one go (weekly, from 2026-11-16). */
async function world(n: number) {
  const b = await plan();
  const a = await account(b);
  const cat = await category(b);
  const now = new Date().toISOString();
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(
      "insert into scheduled_transactions (id, budget_id, account_id, category_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, '2026-11-16', '2026-11-16', 'weekly', ?, 0, ?, ?, ?)",
    ).bind(crypto.randomUUID(), b, a, cat, -100 - i, crypto.randomUUID(), now, now),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { b, cat };
}

const tool = tools.find((t) => t.name === "list_upcoming_for_category");

describe("upcoming: D1 calls", { timeout: 30_000 }, () => {
  it("each read makes the same pinned number of calls for 10 and for 100 schedules", async () => {
    const seen: Record<string, number[]> = {};
    const note = (k: string, n: number) => {
      seen[k] = [...(seen[k] ?? []), n];
    };
    for (const n of [10, 100]) {
      const w = await world(n);
      const c = counting();
      const m = await getPlanMonth(c.env, w.b, NOV);
      note("getPlanMonth", c.calls());
      const fun = m.groups.flatMap((g) => g.categories).find((x) => x.id === w.cat);
      expect(fun?.upcoming_count, "16, 23 and 30 November, n schedules").toBe(3 * n);
      c.reset();
      await getMonthCategory(c.env, w.b, NOV, w.cat);
      note("getMonthCategory", c.calls());
      c.reset();
      const list = await listUpcomingForCategory(c.env, w.b, NOV, w.cat);
      note("listUpcomingForCategory", c.calls());
      expect(list.occurrences).toHaveLength(3 * n);
      c.reset();
      await tool?.run({ budget_id: w.b, month: NOV, category_id: w.cat } as never, {
        env: c.env,
        actor: "user:tester@localhost",
      });
      note("mcp list_upcoming_for_category", c.calls());
      c.reset();
      await previewAutoAssign(c.env, w.b, NOV, { category_ids: [w.cat] }, "2026-11-15");
      note("previewAutoAssign", c.calls());
    }
    const PINNED: Record<string, number> = {
      getPlanMonth: 10,
      getMonthCategory: 10,
      listUpcomingForCategory: 10,
      "mcp list_upcoming_for_category": 10,
      previewAutoAssign: 11,
    };
    for (const [k, v] of Object.entries(seen)) {
      expect(v[0], `${k} at 10 and 100: ${v.join(" / ")}`).toBe(v[1]);
      expect(v[0], k).toBe(PINNED[k]);
    }
  });
});
