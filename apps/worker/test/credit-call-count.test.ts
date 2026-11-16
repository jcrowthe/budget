import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { addUnlinkedAccount, deleteAccount, updateAccount } from "../src/services/accounts";
import { createCategory, createCategoryGroup, updateCategory } from "../src/services/categories";
import { getPlanMonth, getPlanMonths, listPlanMonths } from "../src/services/months";
import { account, actor, type Json, plan, tx } from "./bulk-helpers";
import { json } from "./helpers";

// EXF-532, EXF-535: the D1 calls of the handlers this feature adds or changes ("Services: D1 calls" in
// docs/conventions.md). Each count must be the same for 10 and for 100 categories.

/**
 * Copied from bulk-call-count.test.ts (not exported there): `env` whose database counts each executed
 * statement (run, all, first, raw) and each batch as one call.
 */
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

const DATES = ["2026-09-10", "2026-10-10", "2026-11-10"];

/** `n` categories in two groups, n/10 cards, n/10 checking accounts, one row per category over three months. */
async function world(n: number) {
  const bid = await plan();
  const k = Math.max(1, n / 10);
  const cards: string[] = [];
  const checks: string[] = [];
  for (let i = 0; i < k; i++) {
    checks.push(await account(bid, "checking"));
    const res = await json(
      `/api/v1/budgets/${bid}/accounts`,
      { method: "POST" },
      { name: `ZZ Card ${i}`, type: "creditCard", balance: 0, date: "2026-09-01" },
    );
    expect(res.status).toBe(201);
    cards.push(((await res.json()) as Json).data.account.id);
  }
  const groups = [
    await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ One" }),
    await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Two" }),
  ];
  const cats: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await createCategory(env, actor, {
      budget_id: bid,
      group_id: (groups[i % 2] as { id: string }).id,
      name: `ZZ Cat ${i}`,
    });
    cats.push(c.id);
    await tx(bid, {
      account_id: i % 2 ? cards[i % k] : checks[i % k],
      date: DATES[i % 3],
      amount: -1000 - i,
      category_id: c.id,
    });
  }
  return { bid, cards, checks, cats };
}

const SIZES = [10, 100];

describe("EXF-532/535 D1 calls", () => {
  it("the month read makes 8 D1 calls whatever the plan's size", async () => {
    for (const n of SIZES) {
      const w = await world(n);
      const c = counting();
      await getPlanMonth(c.env, w.bid, "2026-11-01");
      expect(c.calls(), `getPlanMonth at ${n}`).toBe(8);
      c.reset();
      await getPlanMonths(c.env, w.bid, ["2026-09-01", "2026-10-01", "2026-11-01"]);
      expect(c.calls(), `getPlanMonths at ${n}`).toBe(8);
      c.reset();
      await listPlanMonths(c.env, w.bid, "2026-01-01", "2026-12-01");
      expect(c.calls(), `listPlanMonths at ${n}`).toBe(6);
    }
  });

  it("creating a credit account makes as many D1 calls as creating a checking account", async () => {
    for (const cards of [0, 10]) {
      const bid = await plan();
      for (let i = 0; i < cards; i++) {
        await addUnlinkedAccount(env, actor, bid, {
          name: `ZZ Old ${i}`,
          type: "creditCard",
          balance: 0,
          date: "2026-11-01",
        });
      }
      const c = counting();
      await addUnlinkedAccount(c.env, actor, bid, {
        name: "ZZ Plain",
        type: "checking",
        balance: 0,
        date: "2026-11-01",
      });
      const checking = c.calls();
      c.reset();
      await addUnlinkedAccount(c.env, actor, bid, {
        name: "ZZ New Card",
        type: "creditCard",
        balance: 0,
        date: "2026-11-01",
      });
      expect(c.calls(), `with ${cards} cards`).toBe(checking);
    }
  });

  it("renaming and deleting a credit account make the same D1 calls at 10 and at 100 categories", async () => {
    const renames: number[] = [];
    const deletes: number[] = [];
    for (const n of SIZES) {
      const w = await world(n);
      const c = counting();
      await updateAccount(c.env, actor, w.bid, w.cards[0] as string, { name: `ZZ Renamed ${n}` });
      renames.push(c.calls());
      const fresh = await addUnlinkedAccount(env, actor, w.bid, {
        name: `ZZ Fresh ${n}`,
        type: "creditCard",
        balance: 0,
        date: "2026-11-01",
      });
      c.reset();
      await deleteAccount(c.env, actor, w.bid, fresh.account.id);
      deletes.push(c.calls());
    }
    expect(renames[1]).toBe(renames[0]);
    expect(deletes[1]).toBe(deletes[0]);
  });

  it("a payment lock refusal makes the same D1 calls at 10 and at 100 categories", async () => {
    const counts: number[] = [];
    for (const n of SIZES) {
      const w = await world(n);
      const m = await getPlanMonth(env, w.bid, "2026-11-01");
      const pay = m.groups.find((g) => g.kind)?.categories[0]?.id as string;
      const c = counting();
      await expect(
        updateCategory(c.env, actor, { budget_id: w.bid, category_id: pay, name: "ZZ No" }),
      ).rejects.toThrow();
      counts.push(c.calls());
    }
    expect(counts[1]).toBe(counts[0]);
  });
});
