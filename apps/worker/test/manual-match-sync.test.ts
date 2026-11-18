import { beforeEach, describe, expect, it } from "vitest";
import { MATCH, post, UNMATCH } from "./manual-match-helpers";
import { plaidTxn } from "./plaid-stub";
import {
  data,
  feed,
  hand,
  imports,
  type Json,
  q,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  world1,
} from "./plaid-sync-helpers";

beforeEach(async () => {
  await setupPlaid();
  stubBank();
});

describe("the sync after an unmatch (EXF-464, note 2)", () => {
  it("3: neither matches the pair again nor imports the bank's row a second time", async () => {
    const { plan, conn, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -12340,
          payee_name: "ZZ Cafe",
        }),
      )
    ).transaction as Json;
    const entry = plaidTxn({
      transaction_id: "ZZ-BANK-2",
      amount: 12.34,
      date: "2026-03-13",
      name: "ZZ Bank Cafe",
    });
    // matched by the sync's own rule, then unmatched by the owner
    feed.pages = [{ added: [entry] }];
    expect(await syncOne(plan, conn)).toMatchObject({ matched: 1, added: 0 });
    const res = await post(UNMATCH(plan, e.id));
    expect(res.status).toBe(200);
    const liveRows = async () =>
      (await rows(account)).map((r) => `${r.id}|${r.import_id}|${r.amount}|${r.updated_at}`);
    const before = await liveRows();
    expect(before).toHaveLength(3);

    // a re-read: the same entry as added, from a null cursor
    await q("update bank_connections set sync_cursor = null, sync_accounts = null");
    feed.pages = [{ added: [entry] }];
    expect(await syncOne(plan, conn)).toMatchObject({ added: 0, matched: 0 });
    expect(await liveRows()).toEqual(before);
    expect(await imports(account)).toHaveLength(1);

    // the same entry as modified, with the same values
    feed.pages = [{ modified: [entry] }];
    expect(await syncOne(plan, conn)).toMatchObject({ modified: 0, added: 0, matched: 0 });
    expect(await liveRows()).toEqual(before);
  });

  it("a manual match, an unmatch and a re-read: the same", async () => {
    const { plan, conn, account } = await world1();
    const e = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-12",
          amount: -12340,
          payee_name: "ZZ Cafe",
        }),
      )
    ).transaction as Json;
    const bank = plaidTxn({
      transaction_id: "ZZ-BANK-3",
      amount: 13,
      date: "2026-04-01",
      name: "ZZ Bank Cafe",
    });
    feed.pages = [{ added: [bank] }];
    expect(await syncOne(plan, conn)).toMatchObject({ added: 1, matched: 0 });
    const imp = (await imports(account))[0] as Json;
    expect((await post(MATCH(plan), { ids: [e.id, imp.id] })).status).toBe(200);
    // while matched, a re-read leaves the matched row alone and adds nothing
    await q("update bank_connections set sync_cursor = null, sync_accounts = null");
    feed.pages = [{ added: [bank] }];
    expect(await syncOne(plan, conn)).toMatchObject({ added: 0, matched: 0 });
    expect((await rows(account)).filter((r) => r.import_id === "ZZ-BANK-3")).toHaveLength(1);
    expect((await post(UNMATCH(plan, e.id))).status).toBe(200);
    await q("update bank_connections set sync_cursor = null, sync_accounts = null");
    feed.pages = [{ added: [bank] }];
    expect(await syncOne(plan, conn)).toMatchObject({ added: 0, matched: 0 });
    expect((await rows(account)).filter((r) => r.import_id === "ZZ-BANK-3")).toHaveLength(1);
  });
});
