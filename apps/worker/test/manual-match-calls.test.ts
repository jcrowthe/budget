import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { matchTransactions, unmatchTransaction } from "../src/services/manual-match";
import {
  getTransaction,
  listAccountTransactions,
  listPlanTransactions,
} from "../src/services/transactions";
import { sqlImport } from "./manual-match-helpers";
import { countingEnv, q, REST_ACTOR, setupPlaid, stubBank, world1 } from "./plaid-sync-helpers";

beforeEach(async () => {
  await setupPlaid();
  stubBank();
});

/** An account of `n` hand rows plus a pair to match (SQL, so the rows are cheap). */
async function account(n: number) {
  const w = await world1();
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at) values (?, ?, ?, '2026-03-15', -100, 'cleared', 1, '2026-03-15T00:00:00.000Z', '2026-03-15T00:00:00.000Z')",
    ).bind(`zz-fill-${i}-${w.plan.slice(0, 8)}`, w.plan, w.account),
  );
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  const entry = `zz-entry-${w.plan.slice(0, 8)}`;
  await q(
    "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_name) values (?, ?, ?, '2026-03-12', -12340, 'uncleared', 1, '2026-03-12T00:00:00.000Z', '2026-03-12T00:00:00.000Z', 'ZZ Cafe')",
    entry,
    w.plan,
    w.account,
  );
  const imp = await sqlImport(w.plan, w.account, { amount: -13000 });
  return { ...w, entry, imp: imp.id };
}

describe("D1 calls of a manual match (EXF-464)", () => {
  it("match: the same calls for 10 and for 100 rows, at most 7", async () => {
    const counts: number[] = [];
    for (const n of [10, 100]) {
      const a = await account(n);
      const c = countingEnv();
      await matchTransactions(c.env, REST_ACTOR, a.plan, [a.entry, a.imp]);
      counts.push(c.calls.d1);
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeLessThanOrEqual(7);
  });

  it("unmatch: the same calls for 10 and for 100 rows, at most 8", async () => {
    const counts: number[] = [];
    for (const n of [10, 100]) {
      const a = await account(n);
      await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
      const c = countingEnv();
      await unmatchTransaction(c.env, REST_ACTOR, a.plan, a.entry);
      counts.push(c.calls.d1);
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeLessThanOrEqual(8);
  });

  it("the single and list reads make the same calls after a match as before", async () => {
    const a = await account(10);
    const reads = async () => {
      const out: number[] = [];
      for (const run of [
        (e: typeof env) => getTransaction(e, a.plan, a.entry),
        (e: typeof env) => listAccountTransactions(e, a.plan, a.account),
        (e: typeof env) => listPlanTransactions(e, a.plan),
      ]) {
        const c = countingEnv();
        await run(c.env);
        out.push(c.calls.d1);
      }
      return out;
    };
    const before = await reads();
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    expect(await reads()).toEqual(before);
  });
});
