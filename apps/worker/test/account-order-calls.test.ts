import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createAccount } from "../src/services/accounts";
import { reorderAccounts } from "../src/services/account-order";
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

async function world(n: number, tie: boolean) {
  const bid = await plan();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      (await createAccount(env, actor, { budget_id: bid, name: `ZZ ${i}`, type: "checking" })).id,
    );
  }
  if (tie) {
    await env.DB.prepare("update accounts set sort_order = 0 where budget_id = ?").bind(bid).run();
  }
  return { bid, ids };
}

describe("account reorder: D1 calls do not grow with the accounts", () => {
  for (const tie of [false, true]) {
    it(`${tie ? "tie fallback" : "permutation"}: one batch, the same calls for 5 and 50`, async () => {
      const measure = async (n: number) => {
        const w = await world(n, tie);
        const c = counting();
        await reorderAccounts(c.env, actor, {
          budget_id: w.bid,
          account_ids: [...w.ids].reverse(),
        });
        expect(c.batches()).toBe(1);
        return c.calls();
      };
      const [small, large] = [await measure(5), await measure(50)];
      expect(large).toBe(small);
      expect(small).toBe(4);
    });
  }
});
