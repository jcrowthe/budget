import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { payCreditCard } from "../src/services/card-payments";
import { approveTransactions, rejectTransactions } from "../src/services/transactions";
import { bulkTransactions } from "../src/services/transactions-bulk";
import {
  account,
  actor,
  category,
  DAY,
  get,
  type Json,
  MONTH,
  plan,
  send,
  setSql,
  tx,
} from "./bulk-helpers";

/** The Free plan allows 50 D1 calls per invocation: a request's calls must not grow with its rows. */
// EXF-545 adds one set query (paired loans) to the month read that paying a card makes: 20 -> 21.
const LIMIT = 21;

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

type World = {
  b: string;
  ids: string[];
  imports: string[];
  target: string;
  cat: string;
  cat2: string;
};

/** `n` rows: 20% transfers, 10% splits, the rest categorized plain rows; and `n` unapproved imports. */
async function world(n: number): Promise<World> {
  const b = await plan();
  const a1 = await account(b);
  const a2 = await account(b);
  const target = await account(b);
  const cat = await category(b);
  const cat2 = await category(b, "Transportation");
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
  return { b, ids, imports, target, cat, cat2 };
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
  ["categorize", bulk((w) => ({ op: "categorize", value: w.cat2 }))],
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
    expect(
      counts.approve?.[0],
      "EXF-630: approve read the transfer other sides it never used (8 calls)",
    ).toBe(7);
  }, 240000);
});

describe("moving rows from several accounts", () => {
  /** `n` rows round-robin over `sources` accounts; splits and transfers (to a spare account) when `mixed`. */
  async function many(n: number, sources: number, mixed: boolean) {
    const b = await plan();
    const from = [] as string[];
    for (let i = 0; i < sources; i++) from.push(await account(b));
    const spare = await account(b);
    const target = await account(b);
    const cat = await category(b);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = from[i % sources] as string;
      let body: Json = { account_id: a, date: DAY, amount: -100 - i, category_id: cat };
      if (mixed && i % 8 === 0)
        body = { account_id: a, date: DAY, amount: -100 - i, transfer_account_id: spare };
      else if (mixed && i % 8 === 1) {
        body = {
          account_id: a,
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
    return { b, ids, target };
  }

  it("makes the same calls for 10 rows of one account and 100 rows of three, all landing in the target", async () => {
    const small = await many(10, 1, true);
    const large = await many(100, 3, true);
    const calls: number[] = [];
    for (const w of [small, large]) {
      const counter = counting();
      await bulkTransactions(counter.env, actor, w.b, {
        op: "move",
        value: w.target,
        ids: w.ids,
      } as never);
      calls.push(counter.calls());
      for (const id of w.ids) expect((await get(w.b, id)).account_id).toBe(w.target);
    }
    expect(
      calls[1],
      `100 rows of three accounts made ${calls[1]}, 10 of one made ${calls[0]}`,
    ).toBe(calls[0]);
    expect(calls[1]).toBeLessThanOrEqual(LIMIT);
    // Plain rows only: the same holds, so the number of source accounts adds nothing either.
    const plain: number[] = [];
    for (const w of [await many(10, 1, false), await many(100, 3, false)]) {
      const counter = counting();
      await bulkTransactions(counter.env, actor, w.b, {
        op: "move",
        value: w.target,
        ids: w.ids,
      } as never);
      plain.push(counter.calls());
    }
    expect(
      plain[1],
      `plain rows: 100 of three accounts made ${plain[1]}, 10 of one ${plain[0]}`,
    ).toBe(plain[0]);
  }, 240000);
});

describe("paying a card", () => {
  async function cards(nCards: number, rows: number) {
    const b = await plan();
    const checking = await account(b, "checking", 1000000);
    const cat = await category(b);
    const visas: string[] = [];
    for (let i = 0; i < nCards; i++) visas.push(await account(b, "creditCard", 0));
    for (let i = 0; i < rows; i++) {
      await tx(b, {
        account_id: visas[i % nCards] as string,
        date: DAY,
        amount: -1000,
        category_id: cat,
      });
    }
    const set = await send(`/api/v1/budgets/${b}/months/${MONTH}/categories/${cat}`, "PATCH", {
      assigned: rows * 1000,
    });
    expect(set.status).toBe(200);
    return { b, checking, card: visas[0] as string };
  }

  it("makes the same calls for 1 card and 10 rows as for 4 cards and 100 rows, with and without amount", async () => {
    const a = await cards(1, 10);
    const z = await cards(4, 100);
    const figures: Record<string, number[]> = { amount: [], default: [] };
    for (const w of [a, z]) {
      for (const mode of ["amount", "default"] as const) {
        const counter = counting();
        await payCreditCard(counter.env, actor, w.b, w.card, {
          from_account_id: w.checking,
          date: DAY,
          ...(mode === "amount" ? { amount: 1000 } : {}),
        });
        (figures[mode] as number[]).push(counter.calls());
      }
    }
    for (const [mode, [x, y]] of Object.entries(figures)) {
      const msg = `${mode}: 4 cards / 100 rows made ${y} calls, 1 card / 10 rows made ${x} (expected about 9 with an amount, 17 without)`;
      expect(y, msg).toBe(x);
      expect(y, msg).toBeLessThanOrEqual(LIMIT);
    }
    console.log(`payCreditCard calls: ${JSON.stringify(figures)}`);
  }, 240000);
});
