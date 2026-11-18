import { beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../src/services/plaid-sync";
import { plaidTxn } from "./plaid-stub";
import { countingEnv, feed, linked, q, setupPlaid, stubBank, world } from "./plaid-sync-helpers";
import { listed } from "./sync-refresh-helpers";

beforeEach(setupPlaid);

describe("sync refresh: calls", () => {
  it("one sync that adds a bank account stays at 13 D1 and 2 Plaid", async () => {
    stubBank();
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
    const calls = stubBank({ "/accounts/get": listed("acc-chk", "acc-sav", "acc-new") });
    const c = countingEnv();
    calls.length = 0;
    await runSync(c.env, w.conn);
    expect({ d1: c.calls.d1, plaid: calls.length }).toEqual({ d1: 13, plaid: 2 });
    const rows = await q("select 1 from bank_accounts where bank_connection_id = ?", w.conn);
    expect(rows).toHaveLength(3);
  });
});
