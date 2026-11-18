import { beforeEach, describe, expect, it } from "vitest";
import { runSync, syncDueConnections } from "../src/services/plaid-sync";
import { plaidError, plaidTxn } from "./plaid-stub";
import {
  countingEnv,
  feed,
  linked,
  planCalls,
  q,
  setupPlaid,
  stubBank,
  world,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

/**
 * D1 and Plaid calls of this Build's paths (EXF-866). The account and connection reads are pinned in
 * bank-link-calls.test.ts (list 5, get 5) and manage-connections-reads.test.ts (4); they must not grow.
 */
describe("link status: calls", () => {
  it("one sync of a connection with two linked accounts and two new entries: 13 D1, 2 Plaid", async () => {
    const calls = stubBank();
    const w = await world();
    await linked(w.plan, w.bank["ZZ Checking"] as string);
    await linked(w.plan, w.bank["ZZ Savings"] as string);
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-C1", account_id: "acc-chk" }),
          plaidTxn({ transaction_id: "ZZ-S1", account_id: "acc-sav" }),
        ],
      },
    ];
    const c = countingEnv();
    calls.length = 0;
    await runSync(c.env, w.conn);
    expect({ d1: c.calls.d1, plaid: calls.length }).toEqual({ d1: 13, plaid: 2 });
  });

  it("Sync Now on a connection that needs a sign-in: 1 D1, 0 Plaid", async () => {
    const calls = stubBank();
    const w = await world();
    await linked(w.plan, w.bank["ZZ Checking"] as string);
    await q("update bank_connections set status = 'login_required' where id = ?", w.conn);
    const c = countingEnv();
    calls.length = 0;
    await runSync(c.env, w.conn);
    expect({ d1: c.calls.d1, plaid: calls.length }).toEqual({ d1: 1, plaid: 0 });
  });

  it("the nightly loop with nothing due and nothing to check: 2 D1", async () => {
    stubBank();
    const c = countingEnv();
    await syncDueConnections(c.env, new Date());
    expect(c.calls.d1).toBe(2);
  });

  it("a refused check: 5 D1, 1 Plaid", async () => {
    stubBank();
    const w = await world();
    await linked(w.plan, w.bank["ZZ Checking"] as string);
    await q("update bank_connections set status = 'login_required' where id = ?", w.conn);
    const calls = stubBank({ "/accounts/get": () => plaidError(400, "ITEM_LOGIN_REQUIRED") });
    const c = countingEnv();
    await runSync(c.env, w.conn, { check: true });
    expect({ d1: c.calls.d1, plaid: planCalls(calls, "/accounts/get").length }).toEqual({
      d1: 5,
      plaid: 1,
    });
  });
});
