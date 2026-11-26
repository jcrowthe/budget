import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import type { Env } from "../src/env";
import {
  applyToPayees,
  buildPayeeDeleteBatch,
  deletePayee,
  listPayees,
  listPayeeTransactions,
  updatePayee,
} from "../src/services/payees";
import { payeeWorld } from "./manage-payees-helpers";
import { countingEnv, REST_ACTOR } from "./plaid-sync-helpers";

/** `n` transactions on the payee, by SQL so that they are cheap. */
async function fill(w: Awaited<ReturnType<typeof payeeWorld>>, payeeId: string, n: number) {
  const stmts = Array.from({ length: n }, () =>
    env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)",
    ).bind(crypto.randomUUID(), w.bid, w.acct, payeeId),
  );
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/** `n` payees by SQL, each with a transaction. */
async function manyPayees(w: Awaited<ReturnType<typeof payeeWorld>>, n: number, prefix: string) {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  const stmts = ids.flatMap((id, i) => [
    env.DB.prepare(
      "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).bind(id, w.bid, `${prefix} ${i}`),
    env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)",
    ).bind(crypto.randomUUID(), w.bid, w.acct, id),
  ]);
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return ids;
}

const calls = async (run: (e: Env) => Promise<unknown>) => {
  const c = countingEnv();
  await run(c.env);
  return c.calls.d1;
};

describe("D1 calls of the payee operations (EXF-510)", () => {
  it("the list: 3 calls for 10 and for 100 payees", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const w = await payeeWorld();
      await manyPayees(w, n, "ZZ L");
      out.push(await calls((e) => listPayees(e, w.bid, { includeHidden: true })));
    }
    expect(out).toEqual([3, 3]);
  });

  it("rename: 4 calls; hide: 3 calls", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    const a = await w.id("ZZ A");
    expect(await calls((e) => updatePayee(e, REST_ACTOR, w.bid, a, { name: "ZZ A2" }))).toBe(4);
    expect(await calls((e) => updatePayee(e, REST_ACTOR, w.bid, a, { hidden: true }))).toBe(3);
  });

  it("delete with a replacement logs the moved rows: the same calls for 10 and 100 transactions, 11 statements", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const w = await payeeWorld();
      await w.tx("ZZ R");
      await w.sched("ZZ D");
      const r = await w.id("ZZ R");
      const a = await w.id("ZZ D");
      await fill(w, a, n);
      out.push(await calls((e) => deletePayee(e, REST_ACTOR, w.bid, a, r)));
    }
    expect(out).toEqual([4, 4]);
    const w = await payeeWorld();
    const stmts = buildPayeeDeleteBatch(getDb(env), {
      budgetId: w.bid,
      actor: "t",
      now: new Date().toISOString(),
      ids: ["x"],
      replacementId: "y",
      counts: {},
    });
    expect(stmts).toHaveLength(11);
  });

  it("delete: the same calls with 1 and with 500 transactions (3, and 4 with a replacement)", async () => {
    const plain: number[] = [];
    const repl: number[] = [];
    for (const n of [1, 500]) {
      const w = await payeeWorld();
      await w.tx("ZZ R");
      const r = await w.id("ZZ R");
      const [a, b] = await manyPayees(w, 2, "ZZ D");
      await fill(w, a as string, n - 1);
      await fill(w, b as string, n - 1);
      plain.push(await calls((e) => deletePayee(e, REST_ACTOR, w.bid, a as string, null)));
      repl.push(await calls((e) => deletePayee(e, REST_ACTOR, w.bid, b as string, r)));
    }
    expect(plain).toEqual([3, 3]);
    expect(repl).toEqual([4, 4]);
  });

  it("bulk delete of 10 and of 100 payees: 4 calls; bulk hide: 3", async () => {
    const del: number[] = [];
    const hide: number[] = [];
    for (const n of [10, 100]) {
      const w = await payeeWorld();
      await w.tx("ZZ R");
      const r = await w.id("ZZ R");
      const ids = await manyPayees(w, n, "ZZ B");
      hide.push(await calls((e) => applyToPayees(e, REST_ACTOR, w.bid, { ids, action: "hide" })));
      del.push(
        await calls((e) =>
          applyToPayees(e, REST_ACTOR, w.bid, { ids, action: "delete", replacementId: r }),
        ),
      );
    }
    expect(del).toEqual([4, 4]);
    expect(hide).toEqual([3, 3]);
  });

  it("the popover read: 4 calls with 1 and with 500 transactions", async () => {
    const out: number[] = [];
    for (const n of [1, 500]) {
      const w = await payeeWorld();
      await w.tx("ZZ P");
      const p = await w.id("ZZ P");
      await fill(w, p, n - 1);
      out.push(await calls((e) => listPayeeTransactions(e, w.bid, p)));
    }
    expect(out).toEqual([4, 4]);
  });
});
