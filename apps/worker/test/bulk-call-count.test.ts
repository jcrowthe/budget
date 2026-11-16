import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { approveTransactions, rejectTransactions } from "../src/services/transactions";
import { bulkTransactions } from "../src/services/transactions-bulk";
import { account, actor, category, DAY, type Json, plan, setSql, tx } from "./bulk-helpers";

/** The Free plan allows 50 D1 calls per invocation: a request's calls must not grow with its rows. */
const LIMIT = 20;

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

type World = { b: string; ids: string[]; imports: string[]; target: string; cat: string };

/** `n` rows: 20% transfers, 10% splits, the rest categorized plain rows; and `n` unapproved imports. */
async function world(n: number): Promise<World> {
  const b = await plan();
  const a1 = await account(b);
  const a2 = await account(b);
  const target = await account(b);
  const cat = await category(b);
  const ids: string[] = [];
  const nTransfer = Math.max(2, Math.round(n / 5));
  const nSplit = Math.max(1, Math.round(n / 10));
  for (let i = 0; i < n; i++) {
    let body: Json = { account_id: a1, date: DAY, amount: -100 - i, category_id: cat };
    if (i < nTransfer)
      body = { account_id: a1, date: DAY, amount: -100 - i, transfer_account_id: a2 };
    else if (i < nTransfer + nSplit) {
      body = {
        account_id: a1,
        date: DAY,
        amount: -300,
        subtransactions: [
          { amount: -100, category_id: cat },
          { amount: -200, category_id: cat },
        ],
      };
    }
    ids.push((await tx(b, body)).id);
  }
  const imports: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await tx(b, {
      account_id: a1,
      date: DAY,
      amount: -1,
      category_id: cat,
      approved: false,
    });
    await setSql(r.id, `import_id = 'zz-${r.id}', source = 'plaid'`);
    imports.push(r.id);
  }
  return { b, ids, imports, target, cat };
}

type Op = [string, (w: World, e: Env) => Promise<unknown>, ((w: World) => Promise<unknown>)?];
const bulk =
  (body: (w: World) => Json): Op[1] =>
  (w, e) =>
    bulkTransactions(e, actor, w.b, { ...body(w), ids: w.ids } as never);
const OPS: Op[] = [
  ["clear", bulk(() => ({ op: "clear" }))],
  ["unclear", bulk(() => ({ op: "unclear" }))],
  ["memo", bulk(() => ({ op: "memo", value: "x" }))],
  ["categorize", bulk((w) => ({ op: "categorize", value: w.cat }))],
  ["move", bulk((w) => ({ op: "move", value: w.target }))],
  ["flag", bulk(() => ({ op: "flag", value: "red" }))],
  ["duplicate", bulk(() => ({ op: "duplicate" }))],
  [
    "approve",
    (w, e) => approveTransactions(e, actor, w.b, w.ids),
    (w) =>
      env.DB.prepare("update transactions set approved = 0 where budget_id = ?").bind(w.b).run(),
  ],
  ["reject", (w, e) => rejectTransactions(e, actor, w.b, w.imports)],
  ["delete", bulk(() => ({ op: "delete" }))],
];

describe("a request's D1 calls do not grow with its rows", () => {
  it("is the same for 10 and 100 rows and at most 20, for every bulk op, approve and reject", async () => {
    const small = await world(10);
    const large = await world(100);
    const counts: Record<string, [number, number]> = {};
    for (const [name, run, prepare] of OPS) {
      const c: number[] = [];
      for (const w of [small, large]) {
        await prepare?.(w);
        const counter = counting();
        await run(w, counter.env);
        c.push(counter.calls());
      }
      counts[name] = [c[0] as number, c[1] as number];
    }
    for (const [name, [a, z]] of Object.entries(counts)) {
      expect(z, `${name}: 100 rows made ${z} calls, 10 rows made ${a}`).toBe(a);
      expect(z, `${name}: ${z} calls`).toBeLessThanOrEqual(LIMIT);
    }
  }, 240000);
});
