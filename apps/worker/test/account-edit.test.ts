import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { A, account, data, logs, plan, rta, send, tool, txs, USER } from "./account-helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const MCP = "mcp:user:tester@localhost";
const DAY = "2026-11-10";

const toolData = (r: Json) => JSON.parse(r.content[0].text);

describe("account edit surface", () => {
  it("lists the new paths and tools", async () => {
    const paths = await apiPaths();
    for (const p of ["adjust-balance", "close", "reopen"]) {
      expect(paths).toContain(`/api/v1/budgets/{budget_id}/accounts/{account_id}/${p}`);
    }
    const names = await listedToolNames();
    for (const n of [
      "adjust_account_balance",
      "close_account",
      "reopen_account",
      "delete_account",
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe("rename and note", () => {
  it("trims, refuses blank and taken names (case-insensitive), allows own-case change", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0, "ZZ Chk");
    await account(bid, "savings", 0, "ZZ Sav");
    const url = `${A(bid)}/${a.id}`;
    const blank = await send(url, "PATCH", { name: "  " });
    expect(blank.status).toBe(422);
    expect(((await blank.json()) as Json).error.name).toBe("name_required");
    const dup = await send(url, "PATCH", { name: "zz sav" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Json).error.name).toBe("name_taken");
    const own = await send(url, "PATCH", { name: "  zz chk " });
    expect(own.status).toBe(200);
    expect((await data(own)).account.name).toBe("zz chk");
    const noted = await send(url, "PATCH", { note: "line one\nline two" });
    expect((await data(noted)).account.note).toBe("line one\nline two");
    const cleared = await send(url, "PATCH", { note: "   " });
    expect((await data(cleared)).account.note).toBeNull();
    const rows = (await logs(a.id)).filter((r) => r.action === "update");
    expect(rows).toHaveLength(3);
    const same = await send(url, "PATCH", { note: null });
    expect(same.status).toBe(200);
    expect((await logs(a.id)).filter((r) => r.action === "update")).toHaveLength(3);
  });

  it("parallel renames to one name: one wins, one 409", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const rs = await Promise.all(
      [a, b].map((x) => send(`${A(bid)}/${x.id}`, "PATCH", { name: "ZZ Same" })),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("adjust-balance", () => {
  it("adds a Manual Balance Adjustment; on-plan to Ready to Assign, tracking not", async () => {
    const bid = await plan();
    const chk = await account(bid, "checking", 0);
    const before = await rta(bid);
    const res = await send(`${A(bid)}/${chk.id}/adjust-balance`, "POST", {
      balance: 312500,
      today: "2026-11-12",
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.account.balance).toBe(312500);
    expect(d.account.can_delete).toBe(false);
    expect(d.adjustment).toMatchObject({
      date: "2026-11-12",
      payee_name: "Manual Balance Adjustment",
      amount: 312500,
      cleared: "cleared",
      approved: true,
      inflow_to_ready_to_assign: true,
      category_id: null,
    });
    expect(await rta(bid)).toBe(before + 312500);
    const list = await txs(bid, chk.id);
    expect(list.find((t) => t.id === d.adjustment.id)).toMatchObject({
      payee_system: "manual_adjustment",
    });
    const down = await send(`${A(bid)}/${chk.id}/adjust-balance`, "POST", { balance: 0 });
    const downData = await data(down);
    expect(downData.adjustment.amount).toBe(-312500);
    expect(downData.adjustment.date).toBe(new Date().toISOString().slice(0, 10));
    expect(await rta(bid)).toBe(before);
    const payees = await env.DB.prepare(
      "select count(*) n from payees where budget_id = ? and system = 'manual_adjustment'",
    )
      .bind(bid)
      .first<{ n: number }>();
    expect(payees?.n).toBe(1);

    const asset = await account(bid, "otherAsset", 1000000);
    const r0 = await rta(bid);
    const up = await data(
      await send(`${A(bid)}/${asset.id}/adjust-balance`, "POST", { balance: 11000000 }),
    );
    expect(up.adjustment).toMatchObject({ amount: 10000000, inflow_to_ready_to_assign: false });
    expect(await rta(bid)).toBe(r0);
  });

  it("credit card is on-plan; liability is not; unchanged balance writes nothing; closed refused", async () => {
    const bid = await plan();
    const cc = await account(bid, "creditCard", 150000);
    expect(cc.balance).toBe(-150000);
    const same = await data(
      await send(`${A(bid)}/${cc.id}/adjust-balance`, "POST", { balance: -150000 }),
    );
    expect(same.adjustment).toBeNull();
    expect((await logs(cc.id)).filter((r) => r.action === "update")).toHaveLength(0);
    const moved = await data(
      await send(`${A(bid)}/${cc.id}/adjust-balance`, "POST", { balance: -200000 }),
    );
    expect(moved.adjustment).toMatchObject({ amount: -50000, inflow_to_ready_to_assign: true });
    const li = await account(bid, "otherLiability", 5000);
    const l = await data(await send(`${A(bid)}/${li.id}/adjust-balance`, "POST", { balance: 0 }));
    expect(l.adjustment.inflow_to_ready_to_assign).toBe(false);
    await send(`${A(bid)}/${cc.id}/close`, "POST");
    const refused = await send(`${A(bid)}/${cc.id}/adjust-balance`, "POST", { balance: 1000 });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Json).error.name).toBe("account_closed");
  });

  it("five parallel adjustments to one balance leave one adjustment", async () => {
    const bid = await plan();
    const a = await account(bid);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 100000 }),
      ),
    );
    expect(rs.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const list = await txs(bid, a.id);
    expect(list.filter((t) => t.payee_name === "Manual Balance Adjustment")).toHaveLength(1);
    expect(list.reduce((s, t) => s + t.amount, 0)).toBe(100000);
  });
});

describe("REST and MCP give the same rows", () => {
  it("rename, note and adjustment", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0);
    const b = await account(bid, "checking", 0);
    await send(`${A(bid)}/${a.id}`, "PATCH", { name: "ZZ One", note: "n" });
    await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 5000, today: DAY });
    const u = toolData(
      await tool("update_account", {
        budget_id: bid,
        account_id: b.id,
        name: "ZZ Two",
        note: "n",
      }),
    );
    expect(u.account).toMatchObject({ name: "ZZ Two", note: "n" });
    const adj = toolData(
      await tool("adjust_account_balance", {
        budget_id: bid,
        account_id: b.id,
        balance: 5000,
        today: DAY,
      }),
    );
    const ra = (await txs(bid, a.id)).find((t) => t.payee_name === "Manual Balance Adjustment");
    const pick = (t: Json) => ({
      date: t.date,
      amount: t.amount,
      cleared: t.cleared,
      approved: t.approved,
      inflow: t.inflow_to_ready_to_assign,
      memo: t.memo,
    });
    expect(pick(adj.adjustment)).toEqual(pick(ra));
    const shape = (rows: Json[]) => rows.map((r) => `${r.action} ${r.entity_type}`);
    const la = await logs(a.id);
    const lb = await logs(b.id);
    expect(shape(lb.filter((r) => r.entity_type === "account"))).toEqual(
      shape(la.filter((r) => r.entity_type === "account")),
    );
    expect(lb.find((r) => r.action === "update")?.actor).toBe(MCP);
    expect(la.find((r) => r.action === "update")?.actor).toBe(USER);
    const again = toolData(
      await tool("adjust_account_balance", { budget_id: bid, account_id: b.id, balance: 5000 }),
    );
    expect(again.adjustment).toBeNull();
  });
});
