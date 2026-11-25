import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { addUnlinkedAccount } from "../src/services/accounts";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { actor, plan } from "./bulk-helpers";

// EXF-482: the D1 calls of a loan create ("Services: D1 calls" in docs/conventions.md) must not grow with the
// number of categories, and the create is exactly one batch.

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

/** A plan with `n` categories in two groups. */
async function world(n: number) {
  const bid = await plan();
  const g1 = await createCategoryGroup(env, actor, { budget_id: bid, name: `ZZ-TEST A ${n}` });
  const g2 = await createCategoryGroup(env, actor, { budget_id: bid, name: `ZZ-TEST B ${n}` });
  let first = "";
  for (let i = 0; i < n; i++) {
    const c = await createCategory(env, actor, {
      budget_id: bid,
      group_id: i % 2 ? g1.id : g2.id,
      name: `ZZ-TEST cat ${i}`,
    });
    first ||= c.id;
  }
  return { bid, group: g1.id, category: first };
}

type Pairing = (w: { group: string; category: string }) => Record<string, unknown>;
const PAIRINGS: [string, Pairing][] = [
  [
    "new category in a new group",
    () => ({ new_category: { name: "D3 Car", new_group_name: "ZZ-TEST NG" } }),
  ],
  ["new category in a group", (w) => ({ new_category: { name: "D3 Car", group_id: w.group } })],
  ["existing category", (w) => ({ paired_category_id: w.category })],
  ["no pairing", () => ({})],
];

async function measure(n: number, pairing: Pairing) {
  const w = await world(n);
  const c = counting();
  await addUnlinkedAccount(c.env, actor, w.bid, {
    name: "ZZ-TEST Loan",
    type: "autoLoan",
    balance: 25000000,
    interest_rate: "5.25",
    minimum_payment: 450000,
    date: "2026-11-10",
    ...pairing(w),
  });
  return c.calls();
}

describe("loan account create: D1 calls", () => {
  for (const [label, pairing] of PAIRINGS) {
    it(`${label}: the same for 10 and 100 categories`, async () => {
      const small = await measure(10, pairing);
      const large = await measure(100, pairing);
      console.log(`EXF-482 D1 calls (${label}): 10 categories=${small}, 100 categories=${large}`);
      expect(large).toBe(small);
    });
  }

  it("is exactly one batch", async () => {
    const w = await world(10);
    const c = counting();
    let batches = 0;
    const db = c.env.DB;
    const proxied = new Proxy(db, {
      get(t, k) {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "batch") {
          return (...a: unknown[]) => {
            batches += 1;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    await addUnlinkedAccount({ ...c.env, DB: proxied } as Env, actor, w.bid, {
      name: "ZZ-TEST Loan",
      type: "mortgage",
      balance: 25000000,
      interest_rate: "5.25",
      minimum_payment: 450000,
      new_category: { name: "D3 Car", new_group_name: "ZZ-TEST NG" },
      date: "2026-11-10",
    });
    expect(batches).toBe(1);
  });
});
