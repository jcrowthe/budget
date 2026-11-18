import { beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../src/services/plaid-sync";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  countingEnv,
  data,
  feed,
  hand,
  type Json,
  linked,
  setupPlaid,
  stubBank,
  world,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

describe("renaming rules: D1 calls (EXF-467)", () => {
  it("one sync of two accounts with two entries and two rules on the plan: 13 D1, 2 Plaid", async () => {
    const calls = stubBank();
    const w = await world();
    const chk = await linked(w.plan, w.bank["ZZ Checking"] as string);
    await linked(w.plan, w.bank["ZZ Savings"] as string);
    for (const name of ["ZZ Cafe", "ZZ Rides"]) {
      await hand(w.plan, { account_id: chk, date: "2026-03-01", amount: -1000, payee_name: name });
    }
    const list = (await data(await json(`/api/v1/budgets/${w.plan}/payees`))).payees as Json[];
    const rule = async (name: string, kind: string, text: string) =>
      json(
        `/api/v1/budgets/${w.plan}/payees/${list.find((p) => p.name === name)?.id}/rename-rules`,
        { method: "POST" },
        { kind, text },
      );
    expect((await rule("ZZ Cafe", "is", "ZZ BANK CAFE 12")).status).toBe(201);
    expect((await rule("ZZ Rides", "contains", "zz ride")).status).toBe(201);
    feed.pages = [
      {
        added: [
          plaidTxn({
            transaction_id: "ZZ-C1",
            account_id: "acc-chk",
            merchant_name: "ZZ BANK CAFE 12",
          }),
          plaidTxn({ transaction_id: "ZZ-S1", account_id: "acc-sav", merchant_name: "ZZ RIDE 4" }),
        ],
      },
    ];
    const c = countingEnv();
    calls.length = 0;
    await runSync(c.env, w.conn);
    // The same count as without rules (link-status-calls.test.ts): the rules ride the plan's read batch.
    expect({ d1: c.calls.d1, plaid: calls.length }).toEqual({ d1: 13, plaid: 2 });
  });
});
