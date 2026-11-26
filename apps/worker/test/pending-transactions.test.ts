import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import {
  enterNow,
  getAccount,
  hand,
  listPending,
  pend,
  pendingRows,
  pendingWorld,
  posted,
} from "./pending-helpers";
import { count, data, feed, type Json, q, setupPlaid, TX } from "./plaid-sync-helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";
import { setOf, undo } from "./undo-helpers";

beforeEach(setupPlaid);

async function scene() {
  const w = await pendingWorld();
  await w.bank({
    added: [pend("ZZ-P1", { amount: 5 }), pend("ZZ-P2", { amount: -20, name: "ZZ Pend Pay" })],
  });
  const ps = await pendingRows(w.account);
  const id = (pid: string) => ps.find((p) => p.plaid_transaction_id === pid)?.id as string;
  return { ...w, p1: id("ZZ-P1"), p2: id("ZZ-P2") };
}

describe("Enter Now (EXF-466, E1-E7)", () => {
  it("surface: the path and the tools", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/transactions/{transaction_id}/enter-now",
    );
    expect(await listedToolNames()).toContain("enter_pending_transaction");
  });

  it("E1: Enter Now makes a real, approved, uncleared row; balances move; counts do not", async () => {
    const w = await scene();
    const before = await getAccount(w.plan, w.account);
    const res = await enterNow(w.plan, w.p1);
    expect(res.status).toBe(200);
    const tx = (await data(res)).transaction as Json;
    expect(tx).toMatchObject({
      status: "entered",
      approved: true,
      cleared: "uncleared",
      pending_transaction_id: "ZZ-P1",
      amount: -5000,
      account_id: w.account,
    });
    const after = await getAccount(w.plan, w.account);
    expect(after.uncleared_balance - before.uncleared_balance).toBe(-5000);
    expect(after.unapproved_count).toBe(before.unapproved_count);
    expect(after.needs_attention_count).toBe(before.needs_attention_count + 1); // no category: needs one
    const left = (await listPending(w.plan, w.account)).transactions as Json[];
    expect(left.map((t) => t.pending_transaction_id)).toEqual(["ZZ-P2"]);
    // D9: an inflow into checking goes to Ready to Assign
    const inflow = (await data(await enterNow(w.plan, w.p2))).transaction as Json;
    expect(inflow).toMatchObject({ inflow_to_ready_to_assign: true, category_id: null });
  });

  it("E1: a known payee's default category is used", async () => {
    const w = await pendingWorld();
    const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    await hand(w.plan, {
      account_id: w.account,
      date: "2026-03-10",
      amount: -100,
      payee_name: "ZZ Cafe",
      category_id: cat,
    });
    await w.bank({ added: [pend("ZZ-P1", { name: "ZZ Cafe", merchant_name: "ZZ Cafe" })] });
    const [p] = await pendingRows(w.account);
    const tx = (await data(await enterNow(w.plan, p?.id))).transaction as Json;
    expect(tx).toMatchObject({ category_id: cat, payee_name: "ZZ Cafe" });
  });

  it("E2: a body overrides the item; one change set holds both change_log rows", async () => {
    const w = await scene();
    const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    const res = await enterNow(w.plan, w.p1, { category_id: cat, memo: "ZZ memo", amount: -7000 });
    expect(res.status).toBe(200);
    const tx = (await data(res)).transaction as Json;
    expect(tx).toMatchObject({ category_id: cat, memo: "ZZ memo", amount: -7000 });
    const set = setOf(res);
    const logs = (
      await q(
        "select entity_type, action from change_log where change_set_id = ? order by rowid",
        set,
      )
    ).filter((l) => l.entity_type !== "payee");
    expect(logs.map((l) => `${l.action} ${l.entity_type}`).sort()).toEqual(
      ["create transaction", "delete pending_transaction"].sort(),
    );
    expect(
      await count(
        "select count(*) n from transactions where budget_id = ? and pending_transaction_id = 'ZZ-P1'",
        w.plan,
      ),
    ).toBe(1);
  });

  it("E3: Undo restores the pending item; after a sync matched it, Undo is stale", async () => {
    const w = await scene();
    const res = await enterNow(w.plan, w.p1);
    const tx = (await data(res)).transaction as Json;
    const u = await undo(w.plan, setOf(res));
    expect(u.status).toBe(200);
    expect(
      (await q("select deleted_at from transactions where id = ?", tx.id))[0]?.deleted_at,
    ).not.toBeNull();
    const back = (await listPending(w.plan, w.account)).transactions as Json[];
    expect(back.map((t) => t.id).sort()).toEqual([w.p1, w.p2].sort());
    expect(back.find((t) => t.id === w.p1)).toMatchObject({ amount: -5000, status: "pending" });

    const res2 = await enterNow(w.plan, w.p1);
    await w.bank({ added: [posted("ZZ-POST", "ZZ-P1")] });
    const u2 = await undo(w.plan, setOf(res2));
    expect(u2.status).toBe(409);
    expect(u2.body.error.name).toBe("undo_stale");
  });

  it("E4: twice is 404; a pending item removed meanwhile is 409 pending_changed", async () => {
    const w = await scene();
    expect((await enterNow(w.plan, w.p1)).status).toBe(200);
    expect((await enterNow(w.plan, w.p1)).status).toBe(404);
    // a sync replaced p2 between the read and the write: the guard fails, nothing is written
    const { enterPendingTransaction } = await import("../src/services/pending-transactions");
    const { env } = await import("cloudflare:test");
    const proxied = new Proxy(env.DB, {
      get(t, prop) {
        if (prop === "batch") {
          return async (s: D1PreparedStatement[]) => {
            await env.DB.prepare("update pending_transactions set updated_at = '2999' where id = ?")
              .bind(w.p2)
              .run();
            return t.batch(s);
          };
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const logs = await count("select count(*) n from change_log");
    await expect(
      enterPendingTransaction({ ...env, DB: proxied } as typeof env, "user:t", w.plan, w.p2, {}),
    ).rejects.toMatchObject({ code: "pending_changed", status: 409 });
    expect(await count("select count(*) n from change_log")).toBe(logs);
    expect((await pendingRows(w.account)).map((p) => p.id)).toContain(w.p2);
  });

  it("E5: the clock toggles by PATCH; a hand row refuses it; Undo restores it", async () => {
    const w = await scene();
    const tx = (await data(await enterNow(w.plan, w.p1))).transaction as Json;
    const off = await json(`${TX(w.plan)}/${tx.id}`, { method: "PATCH" }, { status: null });
    expect(off.status).toBe(200);
    expect((await data(off)).transaction).toMatchObject({
      status: null,
      pending_transaction_id: "ZZ-P1",
    });
    const on = await json(`${TX(w.plan)}/${tx.id}`, { method: "PATCH" }, { status: "entered" });
    expect((await data(on)).transaction.status).toBe("entered");
    const u = await undo(w.plan, setOf(on));
    expect(u.status).toBe(200);
    expect((await q("select status from transactions where id = ?", tx.id))[0]?.status).toBeNull();
    const h = (
      await data(await hand(w.plan, { account_id: w.account, date: "2026-03-15", amount: -1 }))
    ).transaction as Json;
    const bad = await json(`${TX(w.plan)}/${h.id}`, { method: "PATCH" }, { status: "entered" });
    expect(bad.status).toBe(422);
  });

  it("E6: Enter Now is the user's; the sync is service:plaid", async () => {
    const w = await scene();
    await enterNow(w.plan, w.p1);
    const mine = await q(
      "select actor, entity_type, action from change_log where budget_id = ? and (entity_type = 'pending_transaction' or (entity_type = 'transaction' and json_extract(after_json, '$.status') = 'entered')) order by rowid",
      w.plan,
    );
    const entered = mine.filter((l) => l.actor !== "service:plaid");
    expect(entered.map((l) => `${l.action} ${l.entity_type}`).sort()).toEqual([
      "create transaction",
      "delete pending_transaction",
    ]);
    expect(entered.every((l) => l.actor === "user:tester@localhost")).toBe(true);
    expect(mine.filter((l) => l.actor === "service:plaid")).toHaveLength(2);
  });

  it("E7: the list: another plan's account is 404, account_id alone is 422, plan-wide lists both", async () => {
    const w = await scene();
    const other = await pendingWorld();
    const bad = await json(`${TX(w.plan)}?status=pending&account_id=${other.account}`);
    expect(bad.status).toBe(404);
    expect((await json(`${TX(w.plan)}?account_id=${w.account}`)).status).toBe(422);
    expect((await json(`${TX(w.plan)}?status=pending&q=zz`)).status).toBe(422);
    const all = (await listPending(w.plan)).transactions as Json[];
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      status: "pending",
      account_name: expect.any(String),
      source: "plaid",
    });
  });

  it("a bulk duplicate of an entered row has no pending id or clock", async () => {
    const w = await scene();
    const tx = (await data(await enterNow(w.plan, w.p1))).transaction as Json;
    const res = await json(
      `${TX(w.plan)}/bulk`,
      { method: "POST" },
      { op: "duplicate", ids: [tx.id] },
    );
    expect(res.status).toBe(200);
    const copy = (await data(res)).transactions[0];
    expect(copy).toMatchObject({ status: null, pending_transaction_id: null });
  });

  it("M1: MCP lists pending with include_pending and enters one with an mcp actor", async () => {
    const w = await scene();
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const call = async (name: string, args: Json) => {
      const r = (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
      return JSON.parse(r.content[0].text);
    };
    const without = await call("list_unapproved_transactions", { budget_id: w.plan });
    expect(without.transactions.some((t: Json) => t.status === "pending")).toBe(false);
    const withP = await call("list_unapproved_transactions", {
      budget_id: w.plan,
      include_pending: true,
    });
    expect(withP.transactions.filter((t: Json) => t.status === "pending")).toHaveLength(2);
    const got = await call("enter_pending_transaction", {
      budget_id: w.plan,
      transaction_id: w.p1,
    });
    expect(got.transaction).toMatchObject({ status: "entered", approved: true });
    const actors = await q(
      "select actor from change_log where entity_type = 'pending_transaction' and action = 'delete'",
    );
    expect(actors[0]?.actor).toMatch(/^mcp:/);
    void feed;
  });
});
