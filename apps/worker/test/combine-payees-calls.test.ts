import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import type { Env } from "../src/env";
import * as payeesRepo from "../src/repositories/payees";
import { buildPayeeCombineBatch, combinePayees } from "../src/services/payees";
import { payeeWorld } from "./manage-payees-helpers";
import { countingEnv, REST_ACTOR } from "./plaid-sync-helpers";
import { addRule } from "./rename-rules-helpers";

const NOW = "'2026-01-01T00:00:00.000Z'";

/** `n` transactions on the payee, by SQL so that they are cheap. */
async function fill(w: Awaited<ReturnType<typeof payeeWorld>>, payeeId: string, n: number) {
  const stmts = Array.from({ length: n }, () =>
    env.DB.prepare(
      `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, ${NOW}, ${NOW}, ?)`,
    ).bind(crypto.randomUUID(), w.bid, w.acct, payeeId),
  );
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/** `n` payees by SQL, each with a transaction and a rule. */
async function manyPayees(w: Awaited<ReturnType<typeof payeeWorld>>, n: number) {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  const stmts = ids.flatMap((id, i) => [
    env.DB.prepare(
      `insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, ${NOW}, ${NOW})`,
    ).bind(id, w.bid, `ZZ-TEST M ${i}`),
    env.DB.prepare(
      `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, ${NOW}, ${NOW}, ?)`,
    ).bind(crypto.randomUUID(), w.bid, w.acct, id),
    env.DB.prepare(
      `insert into payee_rename_rules (id, budget_id, payee_id, kind, text, match_text, created_at, updated_at) values (?, ?, ?, 'is', ?, ?, ${NOW}, ${NOW})`,
    ).bind(crypto.randomUUID(), w.bid, id, `zz m ${i}`, `zz m ${i}`),
  ]);
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return ids;
}

const calls = async (run: (e: Env) => Promise<unknown>) => {
  const c = countingEnv();
  await run(c.env);
  return c.calls.d1;
};

describe("D1 calls of the combine (EXF-512)", () => {
  it("the same 4 calls for 2 and for 20 payees", async () => {
    const out: number[] = [];
    for (const n of [2, 20]) {
      const w = await payeeWorld();
      const ids = await manyPayees(w, n);
      out.push(
        await calls((e) => combinePayees(e, REST_ACTOR, w.bid, { ids, name: "ZZ-TEST Merged" })),
      );
    }
    expect(out).toEqual([4, 4]);
  });

  it("the same 4 calls for 10 and for 1000 transactions", async () => {
    const out: number[] = [];
    for (const n of [10, 1000]) {
      const w = await payeeWorld();
      const [a, b] = await manyPayees(w, 2);
      await fill(w, b as string, n);
      await addRule(w.bid, a as string, "contains", "zz extra");
      out.push(
        await calls((e) =>
          combinePayees(e, REST_ACTOR, w.bid, {
            ids: [a as string, b as string],
            name: "ZZ-TEST Merged",
          }),
        ),
      );
    }
    expect(out).toEqual([4, 4]);
  });

  it("the batch has a fixed number of statements", async () => {
    const w = await payeeWorld();
    const [a] = await manyPayees(w, 1);
    const [row] = await payeesRepo.listForPlan(getDb(env), w.bid, {
      includeHidden: true,
      ids: [a as string],
    });
    const stmts = (merged: string[], name: string) =>
      buildPayeeCombineBatch(getDb(env), {
        budgetId: w.bid,
        actor: "t",
        now: new Date().toISOString(),
        survivor: row as payeesRepo.PayeeListRow,
        mergedIds: merged,
        name,
        counts: {},
      }).length;
    const renamed = stmts(["x"], "ZZ-TEST New");
    expect(renamed).toBe(14);
    expect(stmts(["x", "y", "z"], "ZZ-TEST New")).toBe(renamed);
    expect(stmts(["x"], (row as payeesRepo.PayeeListRow).name)).toBe(renamed);
  });
});
