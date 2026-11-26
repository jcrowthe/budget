import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { attachTransactionImage, deleteTransactionImage } from "../src/services/transaction-images";
import {
  getTransaction,
  listAccountTransactions,
  listPlanTransactions,
} from "../src/services/transactions";
import { account, actor, plan, tx } from "./bulk-helpers";
import { PNG } from "./transaction-images-helpers";

/** `env` whose database counts each executed statement and each batch as one call, and records each batch's SQL. */
function counting() {
  let n = 0;
  const batches: string[][] = [];
  const real = new WeakMap<object, D1PreparedStatement>();
  const text = new WeakMap<object, string>();
  const wrap = (st: D1PreparedStatement, sqlText: string): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a), sqlText);
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
    text.set(proxy, sqlText);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "prepare") return (q: string) => wrap(t.prepare(q), q);
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          n += 1;
          batches.push(list.map((s) => text.get(s) ?? ""));
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, batches };
}
const count = async (run: (e: Env) => Promise<unknown>) => {
  const c = counting();
  await run(c.env);
  return c.calls();
};

async function seedRows(b: string, a: string, n: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 1 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign)
     select 'zz-' || hex(randomblob(8)), ?, ?, '2026-11-10', -1000, 'cleared', 1, ?, ?, 0 from s`,
  )
    .bind(n, b, a, now, now)
    .run();
}

/** `n` live images on the account's transactions, one statement. */
async function seedImages(b: string, n: number) {
  await env.DB.prepare(
    `insert into transaction_images (id, budget_id, transaction_id, r2_key, content_type, byte_size, file_name, created_at)
     select 'zi-' || id, budget_id, id, 'transaction-images/seed/' || id, 'image/png', 1, null, ? from transactions where budget_id = ? limit ?`,
  )
    .bind(new Date().toISOString(), b, n)
    .run();
}

describe("transaction images: D1 calls (EXF-536)", () => {
  it("list reads make the same calls with 0, 1 and 50 images (Acc. 7)", async () => {
    const reads = (b: string, a: string, id: string) => [
      (e: Env) => listAccountTransactions(e, b, a, {}),
      (e: Env) => listAccountTransactions(e, b, a, { include: "running_balance" }),
      (e: Env) => listPlanTransactions(e, b, {}),
      (e: Env) => getTransaction(e, b, id),
    ];
    const results: number[][] = [];
    for (const images of [0, 1, 50]) {
      const b = await plan();
      const a = await account(b, "checking", 0);
      await seedRows(b, a, 60);
      const first = (
        await env.DB.prepare("select id from transactions where budget_id = ? limit 1")
          .bind(b)
          .first<{ id: string }>()
      )?.id as string;
      await seedImages(b, images);
      const out: number[] = [];
      for (const r of reads(b, a, first)) out.push(await count(r));
      results.push(out);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("attach and delete make one batch holding the change_log insert and the image write, with the same calls for 0 and 20 sweepable rows", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const t = (await tx(b, { account_id: a, date: "2026-11-10", amount: -5000 })).id as string;
    const attach = (e: Env) =>
      attachTransactionImage(e, actor, {
        budgetId: b,
        transactionId: t,
        bytes: PNG,
        contentType: "image/png",
        fileName: "r.png",
      });
    const remove = (e: Env) => deleteTransactionImage(e, actor, { budgetId: b, transactionId: t });

    const c1 = counting();
    await attach(c1.env);
    const logBatches = c1.batches.filter((s) =>
      s.some((q) => q.includes('insert into "change_log"')),
    );
    expect(logBatches).toHaveLength(1);
    expect(logBatches[0]?.filter((q) => q.includes('"change_log"'))).toHaveLength(1);
    expect(logBatches[0]?.some((q) => q.includes('"transaction_images"'))).toBe(true);
    const attachCalls = c1.calls();
    const c2 = counting();
    await remove(c2.env);
    expect(
      c2.batches.filter((s) => s.some((q) => q.includes('insert into "change_log"'))),
    ).toHaveLength(1);
    const deleteCalls = c2.calls();

    // 20 sweepable rows (soft-deleted, object not yet removed)
    await env.DB.prepare(
      `with recursive s(i) as (select 1 union all select i + 1 from s where i < 20)
       insert into transaction_images (id, budget_id, transaction_id, r2_key, content_type, byte_size, created_at, deleted_at)
       select 'zs-' || hex(randomblob(8)), ?, ?, 'transaction-images/seed/' || i, 'image/png', 1, ?, ? from s`,
    )
      .bind(b, t, new Date().toISOString(), new Date().toISOString())
      .run();
    expect(await count(attach)).toBe(attachCalls);
    expect(await count(remove)).toBe(deleteCalls);
  });
});
