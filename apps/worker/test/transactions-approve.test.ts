import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  A,
  clean,
  count,
  data,
  feed,
  hand,
  imports,
  type Json,
  linked,
  q,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  TX,
  world1,
} from "./plaid-sync-helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

beforeEach(setupPlaid);

async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

const getAccount = async (plan: string, id: string) =>
  (await data(await json(`${A(plan)}/${id}`))).account as Json;
const post = (plan: string, op: "approve" | "reject", ids: string[]) =>
  json(`${TX(plan)}/${op}`, { method: "POST" }, { ids });
const byImport = async (account: string, id: string) =>
  (await imports(account)).find((x) => x.import_id === id) as Json;

/** Three imports: one with a payee that has a category, one without, one inflow. */
async function scene() {
  const calls = stubBank();
  const w = await world1();
  const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
  const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
  await hand(w.plan, {
    account_id: w.account,
    date: "2026-03-10",
    amount: -100,
    payee_name: "ZZ Cafe",
    category_id: cat,
  });
  feed.pages = [
    {
      added: [
        plaidTxn({
          transaction_id: "ZZ-CAT",
          amount: 4.5,
          date: "2026-03-12",
          merchant_name: "ZZ Cafe",
        }),
        plaidTxn({ transaction_id: "ZZ-NOCAT", amount: 7, date: "2026-03-13", name: "ZZ Other" }),
        plaidTxn({ transaction_id: "ZZ-IN", amount: -20, date: "2026-03-14", name: "ZZ Pay" }),
      ],
    },
  ];
  await syncOne(w.plan, w.conn);
  return { ...w, cat, calls };
}

describe("approve and reject (EXF-463, API)", () => {
  it("463-a: counts and the needs filter", async () => {
    const { plan, account } = await scene();
    const a = await getAccount(plan, account);
    expect(a).toMatchObject({ unapproved_count: 3, needs_attention_count: 3 });
    const list = await data(await json(`${TX(plan)}?needs=approval_or_category`));
    expect(list.transactions.map((t: Json) => t.import_id).sort()).toEqual([
      "ZZ-CAT",
      "ZZ-IN",
      "ZZ-NOCAT",
    ]);
    const acc = await data(
      await json(`${A(plan)}/${account}/transactions?needs=approval_or_category`),
    );
    expect(acc.transactions).toHaveLength(3);
    const all = await data(await json(`${TX(plan)}`));
    expect(all.transactions.length).toBeGreaterThan(3);
    const row = list.transactions.find((t: Json) => t.import_id === "ZZ-CAT");
    expect(row).toMatchObject({
      approved: false,
      source: "plaid",
      matched: false,
      bank_description: expect.any(String),
    });
    expect(clean(JSON.stringify(list))).toBe(true);
  });

  it("463-b: approving a categorized row lowers both counts; an uncategorized one only the first", async () => {
    const { plan, account } = await scene();
    const cat = await byImport(account, "ZZ-CAT");
    const nocat = await byImport(account, "ZZ-NOCAT");
    let res = await post(plan, "approve", [cat.id]);
    expect(res.status).toBe(200);
    expect((await data(res)).transactions[0]).toMatchObject({ id: cat.id, approved: true });
    expect(await getAccount(plan, account)).toMatchObject({
      unapproved_count: 2,
      needs_attention_count: 2,
    });
    res = await post(plan, "approve", [nocat.id, nocat.id]);
    expect((await data(res)).transactions).toHaveLength(1);
    expect(await getAccount(plan, account)).toMatchObject({
      unapproved_count: 1,
      needs_attention_count: 2,
    });
    // an approved row is returned as it is: no write
    const logs = await count("select count(*) n from change_log");
    res = await post(plan, "approve", [cat.id]);
    expect(res.status).toBe(200);
    expect(await count("select count(*) n from change_log")).toBe(logs);
    // an unknown id refuses the lot
    const inflow = await byImport(account, "ZZ-IN");
    res = await post(plan, "approve", [inflow.id, "no-such-id"]);
    expect(res.status).toBe(404);
    expect((await byImport(account, "ZZ-IN")).approved).toBe(0);
    const bad = await json(`${TX(plan)}/approve`, { method: "POST" }, { ids: [] });
    expect(bad.status).toBe(422);
  });

  it("463-b: approving one side of a transfer approves the other", async () => {
    stubBank();
    const { plan, account, bank } = await world1();
    const other = await linked(plan, bank["ZZ Savings"] as string);
    const res = await hand(plan, {
      account_id: account,
      date: "2026-03-11",
      amount: -2000,
      transfer_account_id: other,
    });
    const t = (await data(res)).transaction as Json;
    await env.DB.prepare("update transactions set approved = 0 where id in (?, ?)")
      .bind(t.id, t.transfer_transaction_id)
      .run();
    const out = await post(plan, "approve", [t.id]);
    expect(out.status).toBe(200);
    expect(
      await q(
        "select approved from transactions where id in (?, ?)",
        t.id,
        t.transfer_transaction_id,
      ),
    ).toEqual([{ approved: 1 }, { approved: 1 }]);
  });

  it("463-c: reject deletes and records; an approved id is refused and nothing is written", async () => {
    const { plan, conn, account } = await scene();
    const cat = await byImport(account, "ZZ-CAT");
    const nocat = await byImport(account, "ZZ-NOCAT");
    await post(plan, "approve", [cat.id]);
    const logs = await count("select count(*) n from change_log");
    let res = await post(plan, "reject", [nocat.id, cat.id]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error.name).toBe("transaction_approved");
    expect(await count("select count(*) n from change_log")).toBe(logs);
    expect(await byImport(account, "ZZ-NOCAT")).toBeDefined();
    // a transaction that is not an import
    const h = (
      await data(
        await hand(plan, { account_id: account, date: "2026-03-15", amount: -1, approved: false }),
      )
    ).transaction as Json;
    res = await post(plan, "reject", [h.id]);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("not_imported");
    // the rejection itself
    res = await post(plan, "reject", [nocat.id]);
    expect(res.status).toBe(200);
    expect((await data(res)).transactions[0]).toMatchObject({
      id: nocat.id,
      import_id: "ZZ-NOCAT",
    });
    expect(await byImport(account, "ZZ-NOCAT")).toBeUndefined();
    expect(
      await count(
        "select count(*) n from import_tombstones where import_id = 'ZZ-NOCAT' and reason = 'rejected'",
      ),
    ).toBe(1);
    expect((await post(plan, "reject", [nocat.id])).status).toBe(404);
    // a sync does not bring it back, even from the start of the feed
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).added).toBe(0);
    expect(await byImport(account, "ZZ-NOCAT")).toBeUndefined();
  });

  it("463-d: an edit through PATCH approves, unless approved: false is sent", async () => {
    const { plan, account, cat } = await scene();
    const nocat = await byImport(account, "ZZ-NOCAT");
    const inflow = await byImport(account, "ZZ-IN");
    let res = await json(`${TX(plan)}/${nocat.id}`, { method: "PATCH" }, { category_id: cat });
    expect((await data(res)).transaction).toMatchObject({ approved: true, category_id: cat });
    res = await json(
      `${TX(plan)}/${inflow.id}`,
      { method: "PATCH" },
      { memo: "ZZ m", approved: false },
    );
    expect((await data(res)).transaction.approved).toBe(false);
    // a row that stays an import: edited, approved, and a sync leaves it
    expect((await byImport(account, "ZZ-NOCAT")).source).toBe("plaid");
  });

  it("DELETE of a matched hand row writes a tombstone; the entry is not imported again", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const h = (
      await data(
        await hand(plan, {
          account_id: account,
          date: "2026-03-11",
          amount: -3000,
          payee_name: "ZZ Hand",
        }),
      )
    ).transaction as Json;
    feed.pages = [
      { added: [plaidTxn({ transaction_id: "ZZ-MM", amount: 3, date: "2026-03-12" })] },
    ];
    expect((await syncOne(plan, conn)).matched).toBe(1);
    expect((await json(`${TX(plan)}/${h.id}`, { method: "DELETE" })).status).toBe(200);
    expect(
      await count(
        "select count(*) n from import_tombstones where import_id = 'ZZ-MM' and reason = 'deleted'",
      ),
    ).toBe(1);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    expect((await syncOne(plan, conn)).added).toBe(0);
    expect((await rows(account)).some((r) => r.import_id === "ZZ-MM")).toBe(false);
  });

  it("463-e: the tools do the same, with mcp: actors; the surface lists them", async () => {
    const { plan, account } = await scene();
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/transactions/approve",
        "/api/v1/budgets/{budget_id}/transactions/reject",
        "/api/v1/budgets/{budget_id}/sync",
        "/api/v1/bank-connections/{id}/sync",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "list_unapproved_transactions",
        "approve_transactions",
        "reject_transactions",
        "sync_bank_connections",
      ]),
    );
    const listed = (
      await tool("list_unapproved_transactions", { budget_id: plan, account_id: account })
    ).structuredContent as Json;
    expect(listed.transactions).toHaveLength(3);
    const plain = (await tool("list_unapproved_transactions", { budget_id: plan }))
      .structuredContent as Json;
    expect(plain.transactions).toHaveLength(3);
    const cat = await byImport(account, "ZZ-CAT");
    const nocat = await byImport(account, "ZZ-NOCAT");
    const ap = (await tool("approve_transactions", { budget_id: plan, ids: [cat.id] }))
      .structuredContent as Json;
    expect(ap.transactions[0]).toMatchObject({ id: cat.id, approved: true });
    const rj = (await tool("reject_transactions", { budget_id: plan, ids: [nocat.id] }))
      .structuredContent as Json;
    expect(rj.transactions[0].id).toBe(nocat.id);
    const refused = await tool("reject_transactions", { budget_id: plan, ids: [cat.id] });
    expect(refused.isError).toBe(true);
    const actors = (
      await q("select distinct actor from change_log where entity_id in (?, ?)", cat.id, nocat.id)
    ).map((r) => r.actor);
    expect(actors).toContain("mcp:user:tester@localhost");
    expect(actors).toContain("service:plaid");
  });
});
