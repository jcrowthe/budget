import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { minusDays } from "../src/services/account-links";
import { updateTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import {
  A,
  countingEnv,
  data,
  type Json,
  q,
  REST_ACTOR,
  setupPlaid,
  stubBank,
  T,
  world1,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

const sbOf = async (account: string) =>
  (
    (
      await q(
        "select t.id from transactions t join payees p on p.id = t.payee_id where t.account_id = ? and p.system = 'starting_balance' and t.deleted_at is null",
        account,
      )
    )[0] as Json
  ).id as string;

async function extraRows(plan: string, account: string, n: number) {
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at) values (?, ?, ?, ?, -1000, 'cleared', 1, '2026-03-10T00:00:00.000Z', '2026-03-10T00:00:00.000Z')",
    ).bind(`zz-calls-${account.slice(0, 8)}-${i}`, plan, account, T),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

describe("the Starting Balance edit's D1 calls (EXF-774)", () => {
  for (const n of [10, 100]) {
    it(`unlinked date edit = 7, linked move = 10, with ${n} other rows`, async () => {
      stubBank();
      const { plan, account } = await world1();
      await extraRows(plan, account, n);
      const made = await data(
        await json(
          A(plan),
          { method: "POST" },
          { name: "ZZ Manual", type: "checking", balance: 0, date: T },
        ),
      );
      const manual = made.account.id as string;
      await extraRows(plan, manual, n);
      const c = countingEnv();
      await updateTransaction(c.env, REST_ACTOR, plan, await sbOf(manual), {
        date: minusDays(T, 5),
      });
      expect(c.calls.d1).toBe(7);
      c.reset();
      await updateTransaction(c.env, REST_ACTOR, plan, await sbOf(account), {
        date: minusDays(T, 5),
      });
      expect(c.calls.d1).toBe(10);
    });
  }
});
