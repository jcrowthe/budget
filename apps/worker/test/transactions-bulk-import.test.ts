import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  count,
  data,
  feed,
  imports,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  TX,
  world1,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

describe("bulk delete of an import", () => {
  it("leaves a tombstone: the next sync does not bring the entry back", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      { added: [plaidTxn({ transaction_id: "ZZ-BULK", amount: 3, date: "2026-03-12" })] },
    ];
    expect((await syncOne(plan, conn)).added).toBe(1);
    const imported = (await imports(account))[0];
    const res = await json(
      `${TX(plan)}/bulk`,
      { method: "POST" },
      { op: "delete", ids: [imported?.id] },
    );
    expect(res.status).toBe(200);
    expect(
      await count(
        "select count(*) n from import_tombstones where import_id = 'ZZ-BULK' and reason = 'deleted'",
      ),
    ).toBe(1);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).added).toBe(0);
    expect((await rows(account)).some((r) => r.import_id === "ZZ-BULK")).toBe(false);
    expect((await data(res)).changed).toEqual([imported?.id]);
  });
});
