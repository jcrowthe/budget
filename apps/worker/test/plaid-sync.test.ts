import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { plaidError, plaidTxn } from "./plaid-stub";
import {
  balances,
  clean,
  connRow,
  count,
  data,
  feed,
  hand,
  imports,
  type Json,
  linked,
  logCount,
  planCalls,
  q,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  T,
  TX,
  world,
  world1,
} from "./plaid-sync-helpers";
import { apiPaths, listedToolNames } from "./surface";

beforeEach(setupPlaid);

describe("bank import (EXF-462)", () => {
  it("surface: the new paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/bank-connections/{id}/sync",
        "/api/v1/budgets/{budget_id}/sync",
        "/api/v1/budgets/{budget_id}/transactions/approve",
        "/api/v1/budgets/{budget_id}/transactions/reject",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "sync_bank_connections",
        "list_unapproved_transactions",
        "approve_transactions",
        "reject_transactions",
      ]),
    );
  });

  it("462-1: outflow and inflow imported unapproved, pending left out, through the Durable Object", async () => {
    const calls = stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-OUT", amount: 12.34, date: "2026-03-11", name: "ZZ Out" }),
          plaidTxn({ transaction_id: "ZZ-IN", amount: -50, date: "2026-03-12", name: "ZZ In" }),
          plaidTxn({ transaction_id: "ZZ-PEND", pending: true }),
        ],
      },
    ];
    const r = await syncOne(plan, conn);
    expect(r).toMatchObject({ added: 2, matched: 0, status: "connected", has_more: false });
    expect(planCalls(calls, "/transactions/sync")).toHaveLength(1);
    const got = await imports(account);
    expect(got.map((x) => [x.import_id, x.amount, x.approved, x.cleared, x.source])).toEqual([
      ["ZZ-OUT", -12340, 0, "cleared", "plaid"],
      ["ZZ-IN", 50000, 0, "cleared", "plaid"],
    ]);
    expect(got.every((x) => x.import_id !== "ZZ-PEND")).toBe(true);
    expect(clean(JSON.stringify(r))).toBe(true);
  });

  it("462-2: categories: inflow to Ready to Assign; a known payee's last category", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const m = await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    expect(
      (
        await hand(plan, {
          account_id: account,
          date: "2026-03-10",
          amount: -1000,
          payee_name: "ZZ Cafe",
          category_id: cat,
        })
      ).status,
    ).toBe(201);
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-IN", amount: -50, name: "ZZ Pay" }),
          plaidTxn({ transaction_id: "ZZ-NEW", amount: 7, name: "ZZ Other" }),
          plaidTxn({
            transaction_id: "ZZ-CAFE",
            amount: 4.5,
            name: "ZZ CAFE 12",
            merchant_name: "ZZ Cafe",
          }),
        ],
      },
    ];
    await syncOne(plan, conn);
    const by = Object.fromEntries((await imports(account)).map((x) => [x.import_id, x]));
    expect(by["ZZ-IN"]).toMatchObject({ inflow_to_ready_to_assign: 1, category_id: null });
    expect(by["ZZ-NEW"]).toMatchObject({ inflow_to_ready_to_assign: 0, category_id: null });
    expect(by["ZZ-CAFE"]).toMatchObject({ category_id: cat, payee_name: "ZZ Cafe" });
    expect(by["ZZ-CAFE"].imported_payee).toBe("ZZ CAFE 12");
    // the payees are created once
    expect(
      await count("select count(*) n from payees where budget_id = ? and name = 'ZZ Cafe'", plan),
    ).toBe(1);
  });

  it("462-3: syncing again, and again from a null cursor, changes nothing", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-A" }),
          plaidTxn({ transaction_id: "ZZ-B", amount: 3 }),
        ],
      },
    ];
    expect((await syncOne(plan, conn)).added).toBe(2);
    const before = await imports(account);
    const logs = await logCount();
    expect((await syncOne(plan, conn)).added).toBe(0);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    const again = await syncOne(plan, conn);
    expect(again.added).toBe(0);
    expect(again.modified).toBe(0);
    expect(await imports(account)).toEqual(before);
    expect(await logCount()).toBe(logs);
  });

  it("462-4: a rejected or deleted import never comes back", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-R" }),
          plaidTxn({ transaction_id: "ZZ-D", amount: 3 }),
        ],
      },
    ];
    await syncOne(plan, conn);
    const [r, d] = [await imports(account)].flatMap((l) => [
      l.find((x) => x.import_id === "ZZ-R") as Json,
      l.find((x) => x.import_id === "ZZ-D") as Json,
    ]);
    expect((await json(`${TX(plan)}/reject`, { method: "POST" }, { ids: [r?.id] })).status).toBe(
      200,
    );
    expect((await json(`${TX(plan)}/${d?.id}`, { method: "DELETE" })).status).toBe(200);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    const again = await syncOne(plan, conn);
    expect(again.added).toBe(0);
    expect(await imports(account)).toEqual([]);
    expect(
      (
        await q(
          "select import_id, reason, transaction_id from import_tombstones where budget_id = ? order by import_id",
          plan,
        )
      ).map((t) => [t.import_id, t.reason]),
    ).toEqual([
      ["ZZ-D", "deleted"],
      ["ZZ-R", "rejected"],
    ]);
  });

  it("462-5: before the import start, the Starting Balance, or the reconciled grace", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    // before import_start_date
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-EARLY", date: "2026-03-09" }),
          plaidTxn({ transaction_id: "ZZ-START", date: "2026-03-10", amount: 2 }),
        ],
      },
    ];
    let r = await syncOne(plan, conn);
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    // before the Starting Balance date (the import start date is earlier)
    await env.DB.prepare("update accounts set import_start_date = '2026-01-01' where id = ?")
      .bind(account)
      .run();
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    r = await syncOne(plan, conn);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect((await imports(account)).map((x) => x.import_id)).toEqual(["ZZ-START"]);
    // reconciled: set in D1; 4 days before the latest reconciled row is skipped, 3 days before is imported
    const sb = (await rows(account)).find((x) => x.payee_name === "Starting Balance") as Json;
    await env.DB.prepare("update transactions set date = '2026-03-01' where id = ?")
      .bind(sb.id)
      .run();
    await env.DB.prepare(
      "update transactions set cleared = 'reconciled' where id = (select id from transactions where import_id = 'ZZ-START')",
    ).run();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-G4", date: "2026-03-06", amount: 5 }),
          plaidTxn({ transaction_id: "ZZ-G3", date: "2026-03-07", amount: 6 }),
        ],
      },
    ];
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    r = await syncOne(plan, conn);
    expect(r.added).toBe(1);
    expect((await imports(account)).map((x) => x.import_id).sort()).toEqual(["ZZ-G3", "ZZ-START"]);
  });

  it("462-6: later pages, removed, modified", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const a = plaidTxn({ transaction_id: "ZZ-A", amount: 5, name: "ZZ Old" });
    const b = plaidTxn({ transaction_id: "ZZ-B", amount: 6 });
    const c = plaidTxn({ transaction_id: "ZZ-C", amount: 7 });
    feed.pages = [{ added: [a, b, c] }];
    await syncOne(plan, conn);
    const idOf = async (imp: string) =>
      ((await imports(account)).find((x) => x.import_id === imp) as Json).id as string;
    // approve C
    await json(`${TX(plan)}/approve`, { method: "POST" }, { ids: [await idOf("ZZ-C")] });
    feed.pages = [
      { added: [a, b, c] },
      {
        added: [plaidTxn({ transaction_id: "ZZ-D", amount: 8 })],
        modified: [
          { ...a, amount: 9, date: "2026-03-14", name: "ZZ New", original_description: "ZZ RAW" },
          {
            ...c,
            amount: 70,
            date: "2026-03-15",
            name: "ZZ Changed",
            original_description: "ZZ RAW C",
          },
        ],
        removed: ["ZZ-B", "ZZ-C"],
      },
    ];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c1' where id = ?")
      .bind(conn)
      .run();
    const r = await syncOne(plan, conn);
    expect(r).toMatchObject({ added: 1, modified: 1, removed: 1 });
    expect((await rows(account)).some((x) => x.import_id === "ZZ-C")).toBe(true);
    const by = Object.fromEntries((await imports(account)).map((x) => [x.import_id, x]));
    expect(by["ZZ-B"]).toBeUndefined();
    expect(by["ZZ-A"]).toMatchObject({
      amount: -9000,
      date: "2026-03-14",
      payee_name: "ZZ New",
      bank_description: "ZZ RAW",
    });
    // withdrawn after it was modified: the removal wins, and an approved row is kept as it was
    expect(by["ZZ-C"]).toMatchObject({ amount: -7000, date: "2026-03-12", approved: 1 });
    expect(by["ZZ-D"]).toBeDefined();
    expect(await count("select count(*) n from import_tombstones where import_id = 'ZZ-B'")).toBe(
      0,
    );
    // a modified approved row: only the bank's description changes
    feed.pages = [
      {},
      {
        modified: [
          {
            ...c,
            amount: 70,
            date: "2026-03-15",
            name: "ZZ Changed",
            original_description: "ZZ RAW C",
          },
        ],
      },
    ];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c1' where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).modified).toBe(1);
    const c2 = (await imports(account)).find((x) => x.import_id === "ZZ-C") as Json;
    expect(c2).toMatchObject({
      amount: -7000,
      date: "2026-03-12",
      bank_description: "ZZ RAW C",
      approved: 1,
    });
  });

  it("462-7: one create row per import, actor service:plaid", async () => {
    stubBank();
    const { plan, conn } = await world1();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-A" }),
          plaidTxn({ transaction_id: "ZZ-B", amount: 2 }),
        ],
      },
    ];
    await syncOne(plan, conn);
    const l = await q(
      "select actor, action, entity_type, after_json from change_log where budget_id = ? and entity_type = 'transaction' and json_extract(after_json, '$.import_id') is not null",
      plan,
    );
    expect(l).toHaveLength(2);
    expect(l.every((x) => x.actor === "service:plaid" && x.action === "create")).toBe(true);
  });

  it("462-9: success moves the balances and the sync time; a bank error is a status", async () => {
    const calls = stubBank();
    const { plan, conn, bank } = await world1();
    balances["acc-chk"] = 999.25;
    feed.pages = [{ added: [] }];
    const ok = await syncOne(plan, conn);
    expect(ok.status).toBe("connected");
    const b = (
      await q("select current_balance from bank_accounts where id = ?", bank["ZZ Checking"])
    )[0] as Json;
    expect(b.current_balance).toBe(999250);
    const first = await connRow(conn);
    expect(first.last_synced_at).toBeTruthy();
    expect(first.sync_cursor).toBe("c1");
    // 400 ITEM_LOGIN_REQUIRED
    calls.length = 0;
    stubBank({ "/transactions/sync": () => plaidError(400, "ITEM_LOGIN_REQUIRED") });
    const lr = await syncOne(plan, conn);
    expect(lr.status).toBe("login_required");
    const after = await connRow(conn);
    expect(after).toMatchObject({
      status: "login_required",
      sync_cursor: "c1",
      last_synced_at: first.last_synced_at,
    });
    expect(after.sync_error_since).toBeTruthy();
    // a connection that needs repair is not contacted again
    const n = (await syncOne(plan, conn)).status;
    expect(n).toBe("login_required");
    // 500 → delayed
    await env.DB.prepare("update bank_connections set status = 'connected' where id = ?")
      .bind(conn)
      .run();
    stubBank({ "/transactions/sync": () => plaidError(500, "INTERNAL_SERVER_ERROR") });
    expect((await syncOne(plan, conn)).status).toBe("delayed");
  });

  it("462-13: a hand entry is matched, not duplicated", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const m = await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    await hand(plan, {
      account_id: account,
      date: "2026-03-10",
      amount: -12340,
      payee_name: "ZZ Hand",
      memo: "ZZ memo",
      category_id: cat,
    });
    feed.pages = [
      {
        added: [
          plaidTxn({
            transaction_id: "ZZ-M",
            amount: 12.34,
            date: "2026-03-13",
            name: "ZZ Bank Name",
            original_description: "ZZ RAW",
          }),
        ],
      },
    ];
    const r = await syncOne(plan, conn);
    expect(r).toMatchObject({ matched: 1, added: 0 });
    const m1 = (await rows(account)).find((x) => x.import_id === "ZZ-M") as Json;
    expect(m1).toMatchObject({
      payee_name: "ZZ Hand",
      memo: "ZZ memo",
      date: "2026-03-10",
      category_id: cat,
      cleared: "cleared",
      approved: 1,
      source: null,
      imported_payee: "ZZ Bank Name",
      bank_description: "ZZ RAW",
      import_date: "2026-03-13",
      import_amount: -12340,
    });
    const got = await data(await json(`${TX(plan)}/${m1.id}`));
    expect(got.transaction.matched).toBe(true);
    // 12 days apart, or another amount: two rows
    feed.pages = [
      { added: [] },
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-FAR", amount: 5, date: "2026-03-30" }),
          plaidTxn({ transaction_id: "ZZ-AMT", amount: 5.01, date: "2026-03-20" }),
        ],
      },
    ];
    await hand(plan, { account_id: account, date: "2026-03-17", amount: -5000 });
    await env.DB.prepare("update bank_connections set sync_cursor = 'c1' where id = ?")
      .bind(conn)
      .run();
    const r2 = await syncOne(plan, conn);
    expect(r2).toMatchObject({ matched: 0, added: 2 });
    // two candidates: the closer date wins
    await hand(plan, {
      account_id: account,
      date: "2026-04-03",
      amount: -9000,
      payee_name: "ZZ Far",
    });
    await hand(plan, {
      account_id: account,
      date: "2026-04-06",
      amount: -9000,
      payee_name: "ZZ Near",
    });
    feed.pages = [
      { added: [] },
      { added: [] },
      { added: [plaidTxn({ transaction_id: "ZZ-CLOSE", amount: 9, date: "2026-04-08" })] },
    ];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c2' where id = ?")
      .bind(conn)
      .run();
    await syncOne(plan, conn);
    const close = (await rows(account)).find((x) => x.import_id === "ZZ-CLOSE") as Json;
    expect(close.payee_name).toBe("ZZ Near");
  });

  it("462-14: unlinked and closed accounts get balances only; no linked account costs one call", async () => {
    const calls = stubBank();
    const { plan, conn, account, bank } = await world1();
    balances["acc-sav"] = 111;
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-S", account_id: "acc-sav" }),
          plaidTxn({ transaction_id: "ZZ-C" }),
        ],
      },
    ];
    // close the linked account in D1 (still linked)
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(account).run();
    const r = await syncOne(plan, conn);
    expect(r.added).toBe(0);
    expect(await imports(account)).toEqual([]);
    // no open linked account: one Plaid call, cursor unchanged
    expect(planCalls(calls, "/transactions/sync").length).toBe(0);
    expect(planCalls(calls, "/accounts/get").length).toBeGreaterThanOrEqual(1);
    const b = (
      await q("select current_balance from bank_accounts where id = ?", bank["ZZ Savings"])
    )[0] as Json;
    expect(b.current_balance).toBe(111000);
    const c = await connRow(conn);
    expect(c).toMatchObject({ sync_cursor: null, status: "connected" });
    expect(c.last_synced_at).toBeTruthy();
    // an open linked account with transactions only on the unlinked bank account: nothing imported there
    await env.DB.prepare("update accounts set closed = 0 where id = ?").bind(account).run();
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-S2", account_id: "acc-sav" })] }];
    expect((await syncOne(plan, conn)).added).toBe(0);
  });

  it("462-15: a page of 500 imports 500 rows and 500 create rows", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      {
        added: Array.from({ length: 500 }, (_, i) =>
          plaidTxn({ transaction_id: `ZZ-N${String(i).padStart(3, "0")}`, amount: 1 + i / 100 }),
        ),
      },
    ];
    const r = await syncOne(plan, conn);
    expect(r.added).toBe(500);
    expect(await imports(account)).toHaveLength(500);
    expect(
      await count(
        "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction' and action = 'create' and actor = 'service:plaid'",
        plan,
      ),
    ).toBe(500);
  });

  it("462: a mutation error on page 2 restarts and imports each row once", async () => {
    let failed = false;
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [
      { added: [plaidTxn({ transaction_id: "ZZ-1" })] },
      { added: [plaidTxn({ transaction_id: "ZZ-2", amount: 2 })] },
    ];
    const inner = (await import("./plaid-stub")).syncPages(() => feed.pages);
    stubBank({
      "/transactions/sync": (body) => {
        if (body.cursor === "c1" && !failed) {
          failed = true;
          return plaidError(400, "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
        }
        return inner(body);
      },
    });
    const r = await syncOne(plan, conn);
    expect(r.added).toBe(2);
    expect((await imports(account)).map((x) => x.import_id).sort()).toEqual(["ZZ-1", "ZZ-2"]);
  });

  it("462: after an outage, an import with the date and amount of an existing row is skipped for good", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    await hand(plan, {
      account_id: account,
      date: "2026-03-20",
      amount: -4000,
      payee_name: "ZZ Existing",
      cleared: "reconciled",
    }).catch(() => null);
    // a hand row the matcher cannot take (already an import of its own)
    await env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, import_id, source) values ('zz-old', ?, ?, '2026-03-21', -4000, 'cleared', 1, '2026-03-21T00:00:00.000Z', '2026-03-21T00:00:00.000Z', 'ZZ-OLD', 'plaid')",
    )
      .bind(plan, account)
      .run();
    stubBank({ "/transactions/sync": () => plaidError(500, "INTERNAL_SERVER_ERROR") });
    expect((await syncOne(plan, conn)).status).toBe("delayed");
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-DUP", amount: 4, date: "2026-03-21" }),
          plaidTxn({ transaction_id: "ZZ-OK", amount: 4, date: "2026-03-22" }),
        ],
      },
    ];
    stubBank();
    const r = await syncOne(plan, conn);
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect((await connRow(conn)).sync_error_since).toBeNull();
    expect(
      await count(
        "select count(*) n from import_tombstones where import_id = 'ZZ-DUP' and reason = 'duplicate'",
      ),
    ).toBe(1);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    await syncOne(plan, conn);
    expect((await imports(account)).some((x) => x.import_id === "ZZ-DUP")).toBe(false);
  });

  it("462: without an outage the same import is added", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    await env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, import_id, source) values ('zz-old2', ?, ?, '2026-03-21', -4000, 'cleared', 1, '2026-03-21T00:00:00.000Z', '2026-03-21T00:00:00.000Z', 'ZZ-OLD', 'plaid')",
    )
      .bind(plan, account)
      .run();
    feed.pages = [
      { added: [plaidTxn({ transaction_id: "ZZ-SAME", amount: 4, date: "2026-03-21" })] },
    ];
    expect((await syncOne(plan, conn)).added).toBe(1);
  });

  it("note 9: a later-linked account re-reads the feed and leaves the first account's rows as they were", async () => {
    stubBank();
    const { plan, conn, account, bank } = await world1();
    const m = await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    const e = (n: number, over: Json = {}) =>
      plaidTxn({
        transaction_id: `ZZ-E${n}`,
        amount: n + 0.5,
        date: `2026-03-1${n}`,
        name: `ZZ Name ${n}`,
        ...over,
      });
    const entries = [1, 2, 3, 4, 5, 6].map((n) => e(n));
    await hand(plan, {
      account_id: account,
      date: "2026-03-14",
      amount: -4500,
      payee_name: "ZZ Hand 4",
    });
    feed.pages = [{ added: entries }];
    await syncOne(plan, conn);
    const idOf = async (imp: string) =>
      ((await rows(account)).find((x) => x.import_id === imp) as Json).id as string;
    await json(`${TX(plan)}/approve`, { method: "POST" }, { ids: [await idOf("ZZ-E1")] });
    await json(
      `${TX(plan)}/${await idOf("ZZ-E2")}`,
      { method: "PATCH" },
      { memo: "ZZ edited", category_id: cat },
    );
    await json(`${TX(plan)}/reject`, { method: "POST" }, { ids: [await idOf("ZZ-E3")] });
    await env.DB.prepare("update transactions set cleared = 'reconciled' where id = ?")
      .bind(await idOf("ZZ-E5"))
      .run();
    const snapshot = async () => (await rows(account, false)).map((r) => JSON.stringify(r));
    const snapA = await snapshot();
    const logsBefore = await count(
      "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction'",
      plan,
    );
    // link the second bank account later; the feed also carries entries for it
    const accountB = await linked(plan, bank["ZZ Savings"] as string);
    const logsLinked = await count(
      "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction'",
      plan,
    );
    const calls2 = stubBank();
    feed.pages = [
      {
        added: [
          ...entries,
          plaidTxn({
            transaction_id: "ZZ-B1",
            account_id: "acc-sav",
            amount: 3,
            date: "2026-03-12",
          }),
        ],
      },
    ];
    const r = await syncOne(plan, conn);
    const first = planCalls(calls2, "/transactions/sync")[0] as Json;
    expect(first.body.cursor).toBeUndefined();
    expect(r.added).toBe(1);
    expect(await snapshot()).toEqual(snapA);
    expect((await imports(accountB)).map((x) => x.import_id)).toEqual(["ZZ-B1"]);
    expect(
      await count(
        "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction'",
        plan,
      ),
    ).toBe(logsLinked + 1);
    void logsBefore;
  });

  it("note 11: a reconciled row only takes the bank's description", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const a = plaidTxn({ transaction_id: "ZZ-REC", amount: 5, name: "ZZ Orig" });
    const hm = plaidTxn({ transaction_id: "ZZ-HM", amount: 6, date: "2026-03-14" });
    feed.pages = [{ added: [a] }];
    await syncOne(plan, conn);
    await env.DB.prepare(
      "update transactions set cleared = 'reconciled' where import_id = 'ZZ-REC'",
    ).run();
    const before = (await rows(account)).find((x) => x.import_id === "ZZ-REC") as Json;
    feed.pages = [
      { added: [a] },
      {
        modified: [
          {
            ...a,
            amount: 99,
            date: "2026-03-20",
            name: "ZZ Else",
            original_description: "ZZ RAW NEW",
          },
        ],
      },
    ];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c1' where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).modified).toBe(1);
    const after = (await rows(account)).find((x) => x.import_id === "ZZ-REC") as Json;
    const { bank_description: d0, updated_at: u0, ...rest0 } = before;
    const { bank_description: d1, updated_at: u1, ...rest1 } = after;
    expect(rest1).toEqual(rest0);
    expect(d1).toBe("ZZ RAW NEW");
    expect(d0).not.toBe(d1);
    void u0;
    void u1;
    // removed of a reconciled unapproved import keeps it
    feed.pages = [{ added: [a] }, { modified: [] }, { removed: ["ZZ-REC"] }];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c2' where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).removed).toBe(0);
    expect((await imports(account)).map((x) => x.import_id)).toEqual(["ZZ-REC"]);
    // a reconciled hand row stays reconciled when matched
    await hand(plan, {
      account_id: account,
      date: "2026-03-14",
      amount: -6000,
      payee_name: "ZZ HandRec",
    });
    await env.DB.prepare(
      "update transactions set cleared = 'reconciled' where payee_name = 'ZZ HandRec'",
    ).run();
    feed.pages = [{ added: [a] }, { modified: [] }, { removed: [] }, { added: [hm] }];
    await env.DB.prepare("update bank_connections set sync_cursor = 'c3' where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).matched).toBe(1);
    const matched = (await rows(account)).find((x) => x.import_id === "ZZ-HM") as Json;
    expect(matched).toMatchObject({
      cleared: "reconciled",
      date: "2026-03-14",
      amount: -6000,
      payee_name: "ZZ HandRec",
    });
  });
});
