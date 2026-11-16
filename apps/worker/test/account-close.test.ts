import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { A, account, data, logs, plan, rta, send, tool, txs } from "./account-helpers";
import { json } from "./helpers";
import { SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const get = async (bid: string, id: string) => json(`${A(bid)}/${id}`);

describe("close and reopen", () => {
  it("zero balance closes at once; no transaction is added", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0);
    await send(`${A(bid)}/${a.id}`, "PATCH", { starred: true });
    const res = await send(`${A(bid)}/${a.id}/close`, "POST");
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.adjustment).toBeNull();
    expect(d.account).toMatchObject({ closed: true, group: "closed", starred: false, balance: 0 });
    expect(await txs(bid, a.id)).toHaveLength(1);
    const row = (await logs(a.id)).filter((r) => r.action === "update").at(-1);
    expect(JSON.parse(row?.after_json).adjustment_id).toBeNull();
  });

  it("on-plan with a balance: Closed Account adjustment, Ready to Assign falls", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0);
    await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 33330 });
    const before = await rta(bid);
    const d = await data(await send(`${A(bid)}/${a.id}/close`, "POST", { today: "2026-11-11" }));
    expect(d.adjustment).toMatchObject({
      memo: "Closed Account",
      amount: -33330,
      date: "2026-11-11",
      cleared: "cleared",
      payee_name: "Manual Balance Adjustment",
      inflow_to_ready_to_assign: true,
    });
    expect(d.account).toMatchObject({ closed: true, balance: 0 });
    expect(await rta(bid)).toBe(before - 33330);
    const row = (await logs(a.id)).filter((r) => r.action === "update").at(-1);
    expect(JSON.parse(row?.after_json).adjustment_id).toBe(d.adjustment.id);
    const again = await data(await send(`${A(bid)}/${a.id}/close`, "POST"));
    expect(again.adjustment).toBeNull();
  });

  it("tracking account: no category and Ready to Assign unchanged", async () => {
    const bid = await plan();
    const a = await account(bid, "otherAsset", 22220);
    await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 22220 + 1 });
    const before = await rta(bid);
    const d = await data(await send(`${A(bid)}/${a.id}/close`, "POST"));
    expect(d.adjustment).toMatchObject({ amount: -22221, inflow_to_ready_to_assign: false });
    expect(await rta(bid)).toBe(before);
  });

  it("reopen: back in its group, no new transaction, star stays off", async () => {
    const bid = await plan();
    const a = await account(bid, "savings", 5000);
    await send(`${A(bid)}/${a.id}`, "PATCH", { starred: true });
    await send(`${A(bid)}/${a.id}/close`, "POST");
    const n = (await txs(bid, a.id)).length;
    const res = await send(`${A(bid)}/${a.id}/reopen`, "POST");
    const acc = (await data(res)).account;
    expect(acc).toMatchObject({ closed: false, group: "cash", starred: false, balance: 0 });
    expect(await txs(bid, a.id)).toHaveLength(n);
    const rows = await logs(a.id);
    expect(rows.filter((r) => r.action === "update")).toHaveLength(3);
    const open = await send(`${A(bid)}/${a.id}/reopen`, "POST");
    expect(open.status).toBe(200);
    expect((await logs(a.id)).length).toBe(rows.length);
  });
});

describe("delete", () => {
  it("deletes an account holding only its Starting Balance; Ready to Assign drops", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 250000);
    expect(a.can_delete).toBe(true);
    const before = await rta(bid);
    const res = await send(`${A(bid)}/${a.id}`, "DELETE");
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.account_id).toBe(a.id);
    expect(d.deleted_transaction_ids).toHaveLength(1);
    expect((await get(bid, a.id)).status).toBe(404);
    expect(await rta(bid)).toBe(before - 250000);
    const plantx = (await data(await json(`/api/v1/budgets/${bid}/transactions`))).transactions;
    expect(plantx.filter((t: Json) => t.account_id === a.id)).toHaveLength(0);
    const rows = await logs(a.id);
    expect(rows.map((r) => `${r.action} ${r.entity_type}`)).toContain("delete account");
    const stored = await env.DB.prepare("select deleted_at from accounts where id = ?")
      .bind(a.id)
      .first<{ deleted_at: string | null }>();
    expect(stored?.deleted_at).not.toBeNull();
    const txRows = (
      await env.DB.prepare("select deleted_at from transactions where account_id = ?")
        .bind(a.id)
        .all<Json>()
    ).results;
    expect(txRows.every((r) => r.deleted_at !== null)).toBe(true);
    expect((await logs(d.deleted_transaction_ids[0])).map((r) => r.action)).toContain("delete");
  });

  it("refuses with 409 has_transactions and writes nothing", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0);
    await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 1000 });
    expect((await get(bid, a.id).then(data)).account.can_delete).toBe(false);
    const before = (await logs(a.id)).length;
    const res = await send(`${A(bid)}/${a.id}`, "DELETE");
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error.name).toBe("has_transactions");
    expect((await logs(a.id)).length).toBe(before);
    expect((await get(bid, a.id)).status).toBe(200);
    const t = await tool("delete_account", { budget_id: bid, account_id: a.id });
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toContain("cannot be deleted");
    const ok = await account(bid);
    const done = await tool("delete_account", { budget_id: bid, account_id: ok.id });
    expect(done.isError).toBeFalsy();
  });

  it("a closed account with history cannot be deleted", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 0);
    await send(`${A(bid)}/${a.id}/close`, "POST");
    expect((await get(bid, a.id).then(data)).account.can_delete).toBe(false);
    expect((await send(`${A(bid)}/${a.id}`, "DELETE")).status).toBe(409);
  });
});

describe("linked accounts", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-edit-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: [
            {
              account_id: "acc-a",
              name: "ZZ A",
              mask: "0000",
              type: "depository",
              subtype: "checking",
              balances: { current: 10, available: null },
            },
            {
              account_id: "acc-b",
              name: "ZZ B",
              mask: "0001",
              type: "depository",
              subtype: "savings",
              balances: { current: 20, available: null },
            },
          ],
        },
      }),
      "/institutions/get_by_id": () => ({
        body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
      }),
      "/item/remove": () => ({ body: { removed: true } }),
    });
  });

  it("close and delete unlink in the same batch", async () => {
    const { createPlan: mk } = await import("./plaid-stub");
    const bid = await mk("sandbox");
    const conn = await data(
      await json(
        "/api/v1/bank-connections",
        { method: "POST" },
        { budget_id: bid, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
      ),
    );
    const c = conn.bank_connection ?? conn;
    const [ba, bb] = c.accounts as Json[];
    const made = await data(
      await send(`${A(bid)}/from-bank`, "POST", { bank_account_ids: [ba.id, bb.id] }),
    );
    const [x, y] = made.created.map((m: Json) => m.account);
    const linkedOf = async (bank: string) =>
      (
        await data(await json(`/api/v1/bank-connections/${c.id}?budget_id=${bid}`))
      ).bank_connection.accounts.find((q: Json) => q.id === bank).linked_account_id;
    expect(await linkedOf(ba.id)).toBe(x.id);
    const before = (await logs(x.id)).filter((r) => r.action === "update").length;
    const closed = (await data(await send(`${A(bid)}/${x.id}/close`, "POST"))).account;
    expect(closed).toMatchObject({ linked: false, bank_account_id: null, closed: true });
    expect(await linkedOf(ba.id)).toBeNull();
    expect((await logs(x.id)).filter((r) => r.action === "update").length).toBe(before + 1);
    expect(y.linked).toBe(true);
    const del = await send(`${A(bid)}/${y.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect(await linkedOf(bb.id)).toBeNull();
  });
});
