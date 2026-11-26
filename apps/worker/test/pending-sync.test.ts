import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import {
  enterNow,
  getAccount,
  listPending,
  pend,
  pendingRows,
  pendingWorld,
  posted,
} from "./pending-helpers";
import { plaidTxn } from "./plaid-stub";
import {
  count,
  data,
  feed,
  type Json,
  linked,
  logCount,
  q,
  rows,
  setupPlaid,
  TX,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

const month = async (plan: string) =>
  (await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`))) as Json;
const balancesOf = (a: Json) => ({
  cleared: a.cleared_balance,
  uncleared: a.uncleared_balance,
  working: a.balance,
  unapproved: a.unapproved_count,
  attention: a.needs_attention_count,
});

describe("pending items are stored and change nothing (EXF-466, S1-S4)", () => {
  it("S1: stored in pending_transactions; balances and the plan equal the feed without them", async () => {
    const posted2 = [
      plaidTxn({ transaction_id: "ZZ-OUT", amount: 12.34, date: "2026-03-11", name: "ZZ Out" }),
      plaidTxn({ transaction_id: "ZZ-IN", amount: -50, date: "2026-03-12", name: "ZZ In" }),
    ];
    const withPending = await pendingWorld();
    const r = await withPending.bank({
      added: [
        ...posted2,
        pend("ZZ-P1", { amount: 5, name: "ZZ Pend Cafe" }),
        pend("ZZ-P2", { amount: -20, name: "ZZ Pend Pay" }),
      ],
    });
    expect(r).toMatchObject({ added: 2, matched: 0, modified: 0, removed: 0, skipped: 0 });
    const have = await pendingRows(withPending.account);
    expect(have.map((x) => [x.plaid_transaction_id, x.amount, x.payee_name])).toEqual([
      ["ZZ-P1", -5000, "ZZ Pend Cafe"],
      ["ZZ-P2", 20000, "ZZ Pend Pay"],
    ]);
    expect(await q("select id from payees where name like 'ZZ Pend%'")).toEqual([]);
    expect(await rows(withPending.account)).toHaveLength(3); // Starting Balance + 2 imports
    const a = balancesOf(await getAccount(withPending.plan, withPending.account));
    const m = await month(withPending.plan);

    // the same feed without pending, in a plan of its own
    await setupPlaid();
    const without = await pendingWorld();
    await without.bank({ added: posted2 });
    expect(balancesOf(await getAccount(without.plan, without.account))).toEqual(a);
    expect(JSON.stringify(await month(without.plan)).replace(/[0-9a-f-]{36}/g, "")).toEqual(
      JSON.stringify(m).replace(/[0-9a-f-]{36}/g, ""),
    );
  });

  it("S2: a re-sync and a cursor-null re-read add no rows and no change_log rows", async () => {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-P1"), pend("ZZ-P2", { amount: -3 })] });
    const logs = await logCount();
    const have = await pendingRows(w.account);
    expect(have).toHaveLength(2);
    await w.bank({});
    expect(await logCount()).toBe(logs);
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(w.conn)
      .run();
    await w.bank({});
    expect(await logCount()).toBe(logs);
    expect(await pendingRows(w.account, false)).toEqual(have);
  });

  it("S3: closed account, before the start date and before the reconciled cutoff store nothing", async () => {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-OLD", { date: "2026-02-01" }), pend("ZZ-OK")] });
    expect((await pendingRows(w.account, false)).map((p) => p.plaid_transaction_id)).toEqual([
      "ZZ-OK",
    ]);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.account).run();
    await w.bank({ added: [pend("ZZ-CLOSED")] });
    expect((await pendingRows(w.account, false)).map((p) => p.plaid_transaction_id)).toEqual([
      "ZZ-OK",
    ]);
  });

  it("S4: an untouched pending item follows the bank; one update row by service:plaid", async () => {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-P1", { amount: 5, date: "2026-03-12", name: "ZZ Pend A" })] });
    const r = await w.bank({
      modified: [pend("ZZ-P1", { amount: 6.5, date: "2026-03-14", name: "ZZ Pend B" })],
    });
    expect(r).toMatchObject({ added: 0, modified: 0 });
    const [p] = await pendingRows(w.account);
    expect(p).toMatchObject({ amount: -6500, date: "2026-03-14", payee_name: "ZZ Pend B" });
    const logs = await w.logs("pending_transaction");
    expect(logs.map((l) => [l.action, l.actor])).toEqual([
      ["create", "service:plaid"],
      ["update", "service:plaid"],
    ]);
  });
});

describe("posted replaces or matches (S5-S11)", () => {
  it("S5: a posted entry replaces an untouched pending item (unapproved import)", async () => {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-P1", { amount: 5 })] });
    const r = await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 5.25 })] });
    expect(r).toMatchObject({ added: 1 });
    expect(await pendingRows(w.account)).toEqual([]);
    const [t] = (await rows(w.account)).filter((x) => x.import_id === "ZZ-POST");
    expect(t).toMatchObject({
      amount: -5250,
      approved: 0,
      source: "plaid",
      pending_transaction_id: "ZZ-P1",
    });
    const del = (await w.logs("pending_transaction")).filter((l) => l.action === "delete");
    expect(del).toHaveLength(1);
    expect(del[0]?.actor).toBe("service:plaid");
    expect(JSON.parse(del[0]?.after_json)).toEqual({ replaced_by: t?.id });
    const cr = await q(
      "select actor from change_log where entity_type = 'transaction' and entity_id = ? and action = 'create'",
      t?.id,
    );
    expect(cr).toEqual([{ actor: "service:plaid" }]);
  });

  async function entered(over: Json = {}) {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-P1", { amount: 5, ...over })] });
    const [p] = await pendingRows(w.account);
    const res = await enterNow(w.plan, p?.id);
    expect(res.status).toBe(200);
    const tx = (await data(res)).transaction as Json;
    return { ...w, p, tx };
  }

  it("S6: Enter Now, then posted with a tip: the row is matched, cleared, approved, bank amount", async () => {
    const w = await entered();
    const before = (await rows(w.account)).length;
    const r = await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    expect(r).toMatchObject({ added: 0, matched: 1 });
    const all = await rows(w.account);
    expect(all).toHaveLength(before);
    expect(all.find((x) => x.id === w.tx.id)).toMatchObject({
      amount: -6000,
      cleared: "cleared",
      approved: 1,
      import_id: "ZZ-POST",
      status: null,
      pending_transaction_id: "ZZ-P1",
      match_entry_amount: -5000,
    });
    const ups = await q(
      "select actor from change_log where entity_type = 'transaction' and entity_id = ? and action = 'update'",
      w.tx.id,
    );
    expect(ups).toEqual([{ actor: "service:plaid" }]);
    const t = await data(await json(`${TX(w.plan)}/${w.tx.id}`));
    expect(t.transaction).toMatchObject({ matched: true, status: null });
    expect(t.transaction.match_details).not.toBeNull();
    const [pr] = await pendingRows(w.account, false);
    expect(pr?.resolved_at).not.toBeNull();
  });

  it("S7: a reconciled entered row keeps its amount and stays reconciled (D12)", async () => {
    const w = await entered();
    await env.DB.prepare("update transactions set cleared = 'reconciled' where id = ?")
      .bind(w.tx.id)
      .run();
    await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    const [t] = await q("select * from transactions where id = ?", w.tx.id);
    expect(t).toMatchObject({
      amount: -5000,
      cleared: "reconciled",
      approved: 1,
      import_id: "ZZ-POST",
    });
  });

  it("S8: a split keeps its amount; a row moved to another account is imported anew (D14)", async () => {
    const w = await entered();
    const m = await month(w.plan);
    const [c1, c2] = m.groups.flatMap((g: Json) => g.categories) as [Json, Json];
    const split = await json(
      `${TX(w.plan)}/${w.tx.id}`,
      { method: "PATCH" },
      {
        subtransactions: [
          { amount: -2000, category_id: c1.id },
          { amount: -3000, category_id: c2.id },
        ],
      },
    );
    expect(split.status).toBe(200);
    await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    const [t] = await q("select * from transactions where id = ?", w.tx.id);
    expect(t).toMatchObject({ amount: -5000, approved: 1, import_id: "ZZ-POST" });

    // moved
    await setupPlaid();
    const v = await entered();
    const other = await linked(v.plan, v.bankIds["ZZ Savings"] as string);
    await env.DB.prepare("update transactions set account_id = ? where id = ?")
      .bind(other, v.tx.id)
      .run();
    await v.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    const imp = (await rows(v.account)).filter((x) => x.import_id === "ZZ-POST");
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ approved: 0, source: "plaid" });
    expect(
      (await q("select import_id from transactions where id = ?", v.tx.id))[0]?.import_id,
    ).toBeNull();
  });

  it("S9: an entered row the user deleted: the posted version is a new unapproved import", async () => {
    const w = await entered();
    expect((await json(`${TX(w.plan)}/${w.tx.id}`, { method: "DELETE" })).status).toBe(200);
    await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    const imp = (await rows(w.account)).filter((x) => x.import_id === "ZZ-POST");
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ approved: 0, source: "plaid", amount: -6000 });
  });

  it("S10: removed: an untouched item goes; an entered one stays, uncleared, with resolved_at", async () => {
    const w = await pendingWorld();
    await w.bank({ added: [pend("ZZ-P1"), pend("ZZ-P2", { amount: 7 })] });
    const ps = await pendingRows(w.account);
    const second = ps.find((x) => x.plaid_transaction_id === "ZZ-P2") as Json;
    const res = await enterNow(w.plan, second.id);
    expect(res.status).toBe(200);
    const tx = (await data(res)).transaction as Json;
    await w.bank({ removed: ["ZZ-P1", "ZZ-P2"] });
    expect((await listPending(w.plan, w.account)).transactions).toEqual([]);
    const del = (await w.logs("pending_transaction")).filter(
      (l) => l.action === "delete" && l.actor === "service:plaid" && l.budget_id === w.plan,
    );
    expect(del.map((l) => l.entity_id)).toEqual([
      ps.find((x) => x.plaid_transaction_id === "ZZ-P1")?.id,
    ]);
    const [t] = await q("select * from transactions where id = ?", tx.id);
    expect(t).toMatchObject({
      cleared: "uncleared",
      status: "entered",
      deleted_at: null,
      import_id: null,
    });
    const [pr] = await q("select resolved_at from pending_transactions where id = ?", second.id);
    expect(pr?.resolved_at).not.toBeNull();
  });

  it("S11: unmatch of a matched entered row gives back its own amount and an unapproved import", async () => {
    const w = await entered();
    await w.bank({ added: [posted("ZZ-POST", "ZZ-P1", { amount: 6 })] });
    const res = await json(`${TX(w.plan)}/${w.tx.id}/unmatch`, { method: "POST" });
    expect(res.status).toBe(200);
    const out = await data(res);
    expect(out.transaction.amount).toBe(-5000);
    expect(out.imported).toMatchObject({ approved: false, amount: -6000, import_id: "ZZ-POST" });
  });

  it("S13: an entered row waits for its own posted version, not another import of the same amount", async () => {
    const w = await entered();
    await w.bank({
      added: [
        plaidTxn({ transaction_id: "ZZ-OTHER", amount: 5, date: "2026-03-14", name: "ZZ Else" }),
      ],
    });
    const imp = (await rows(w.account)).filter((x) => x.import_id === "ZZ-OTHER");
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ approved: 0, source: "plaid" });
    expect((await q("select * from transactions where id = ?", w.tx.id))[0]).toMatchObject({
      import_id: null,
      status: "entered",
    });
  });

  it("S12: a mutation error mid-run, then the next run: each pending row exists once", async () => {
    const { failingBatchEnv } = await import("./plaid-sync-helpers");
    const { runSync } = await import("../src/services/plaid-sync");
    const w = await pendingWorld();
    feed.pages = [{ added: [pend("ZZ-P1"), pend("ZZ-P2", { amount: 8 })] }] as typeof feed.pages;
    await expect(runSync(failingBatchEnv(2), w.conn)).rejects.toThrow();
    await runSync(env, w.conn);
    await runSync(env, w.conn);
    const live = await pendingRows(w.account);
    expect(live.map((x) => x.plaid_transaction_id)).toEqual(["ZZ-P1", "ZZ-P2"]);
    expect(
      await count(
        "select count(*) n from (select plaid_transaction_id from pending_transactions where account_id = ? and deleted_at is null group by 1 having count(*) > 1)",
        w.account,
      ),
    ).toBe(0);
  });
});
