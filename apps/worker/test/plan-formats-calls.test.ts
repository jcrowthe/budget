import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createBudget, getBudget, listBudgets, updateBudget } from "../src/services/budgets";
import { actor } from "./bulk-helpers";

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

describe("plan formats: D1 calls do not grow", () => {
  it("PATCH makes 2 calls for a rename and for every field; reads and create make 1", async () => {
    const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
    const rename = counting();
    await updateBudget(rename.env, actor, b.id, { name: "ZZ-TEST renamed" });
    expect(rename.calls()).toBe(2);
    const all = counting();
    await updateBudget(all.env, actor, b.id, {
      name: "ZZ-TEST again",
      currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
      date_format: { format: "DD.MM.YYYY" },
    });
    expect(all.calls()).toBe(2);
    const one = counting();
    await getBudget(one.env, b.id);
    expect(one.calls()).toBe(1);
    const list = counting();
    await listBudgets(list.env);
    expect(list.calls()).toBe(1);
    const create = counting();
    await createBudget(create.env, actor, {
      name: `ZZ-TEST ${crypto.randomUUID()}`,
      currency_format: { iso_code: "JPY" },
    });
    expect(create.calls()).toBe(1);
  });
});
