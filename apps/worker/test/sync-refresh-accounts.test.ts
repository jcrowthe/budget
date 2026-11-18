import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { tools } from "../src/mcp/tools/bank-connections";
import * as bankRepo from "../src/repositories/bank-connections";
import { bankAccountRow } from "../src/services/bank-connections";
import { runSync } from "../src/services/plaid-sync";
import { json } from "./helpers";
import {
  A,
  data,
  type Json,
  linked,
  logCount,
  q,
  setupPlaid,
  stubBank,
  syncOne,
  world,
  world1,
} from "./plaid-sync-helpers";
import { listed } from "./sync-refresh-helpers";

beforeEach(setupPlaid);

const bankRows = (conn: string) =>
  q("select * from bank_accounts where bank_connection_id = ? order by created_at, name", conn);
const withList = (...ids: string[]) => stubBank({ "/accounts/get": listed(...ids) });

describe("a connection's bank accounts follow the bank's list (EXF-875)", () => {
  it("7 a bank account the bank newly lists is added once, unlinked, with the creation's mapping", async () => {
    for (const make of [world1, world]) {
      stubBank();
      const w = await make();
      withList("acc-chk", "acc-sav", "acc-new");
      await runSync(env, w.conn);
      const rows = await bankRows(w.conn);
      expect(rows).toHaveLength(3);
      const n = rows.find((r) => r.plaid_account_id === "acc-new") as Json;
      expect(n).toMatchObject({
        name: "ZZ Rewards",
        mask: "4321",
        type: "credit",
        subtype: "credit card",
        current_balance: 50000,
        available_balance: null,
      });
      expect(n.balance_updated_at).not.toBeNull();
      expect(await q("select id from accounts where bank_account_id = ?", n.id)).toHaveLength(0);
      await runSync(env, w.conn);
      expect(await bankRows(w.conn)).toHaveLength(3);
    }
  });

  it("8 two syncs at once and a rerun add it once", async () => {
    stubBank();
    const w = await world();
    withList("acc-chk", "acc-sav", "acc-new");
    const both = await Promise.allSettled([runSync(env, w.conn), runSync(env, w.conn)]);
    expect(both.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await bankRows(w.conn)).toHaveLength(3);
    const db = getDb(env);
    const a = { account_id: "acc-two", name: "ZZ Two", type: "depository", balances: {} };
    const guard = sql`(select 1)`;
    const out = await db.batch([
      bankRepo.insertAccountIfStmt(db, bankAccountRow(w.conn, a, new Date().toISOString()), guard),
      bankRepo.insertAccountIfStmt(db, bankAccountRow(w.conn, a, new Date().toISOString()), guard),
    ]);
    expect(out.map((r) => r.meta.changes)).toEqual([1, 0]);
  });

  it("9 a changed name or mask is followed, only when it changed", async () => {
    stubBank();
    const w = await world();
    const list = listed("acc-chk", "acc-sav");
    stubBank({
      "/accounts/get": async (b) => {
        const r = (await list(b)) as { body: { accounts: Json[] } };
        const sav = r.body.accounts.find((x) => x.account_id === "acc-sav") as Json;
        sav.name = "ZZ Savings Plus";
        sav.mask = "9999";
        return r;
      },
    });
    const logs = await logCount();
    await runSync(env, w.conn);
    const sav = (await bankRows(w.conn)).find((r) => r.plaid_account_id === "acc-sav") as Json;
    expect({ name: sav.name, mask: sav.mask }).toEqual({ name: "ZZ Savings Plus", mask: "9999" });
    const before = await bankRows(w.conn);
    const logsAfter = await logCount();
    await runSync(env, w.conn);
    const after = await bankRows(w.conn);
    for (const [i, r] of before.entries()) {
      const { balance_updated_at: _a, ...x } = r;
      const { balance_updated_at: _b, ...y } = after[i] as Json;
      expect(y).toEqual(x);
    }
    expect(await logCount()).toBe(logsAfter);
    expect(logs).toBeLessThanOrEqual(logsAfter);
  });

  it("10 an unlinked account that left the list goes; a linked one stays and is marked; an empty list changes nothing", async () => {
    stubBank();
    const a = await world();
    withList("acc-chk");
    await runSync(env, a.conn);
    expect((await bankRows(a.conn)).map((r) => r.plaid_account_id)).toEqual(["acc-chk"]);

    stubBank();
    const b = await world1();
    withList("acc-sav");
    await runSync(env, b.conn);
    expect(await bankRows(b.conn)).toHaveLength(2);
    const acc = (await data(await json(`${A(b.plan)}/${b.account}`))).account as Json;
    expect(acc.link_missing_since).not.toBeNull();

    stubBank();
    const c = await world();
    withList();
    await runSync(env, c.conn);
    expect(await bankRows(c.conn)).toHaveLength(2);
  });

  it("11 Relink offers the new account; the old one is dropped once unlinked and unlisted", async () => {
    stubBank();
    const w = await world1();
    withList("acc-sav", "acc-new");
    await runSync(env, w.conn);
    const fresh = (await bankRows(w.conn)).find((r) => r.plaid_account_id === "acc-new") as Json;
    const res = await json(
      `${A(w.plan)}/${w.account}/link`,
      { method: "POST" },
      { bank_account_id: fresh.id },
    );
    expect(res.status).toBe(200);
    expect(((await data(res)).account as Json).link_missing_since).toBeNull();
    await runSync(env, w.conn);
    const acc = (await data(await json(`${A(w.plan)}/${w.account}`))).account as Json;
    expect(acc.link_missing_since).toBeNull();
    expect((await bankRows(w.conn)).map((r) => r.plaid_account_id).sort()).toEqual([
      "acc-new",
      "acc-sav",
    ]);
  });

  it("12 after Reset and one sync the list is up to date, in REST and in the tool", async () => {
    stubBank();
    const w = await world1();
    await q(
      "update bank_connections set status = 'login_required', sync_error_code = 'INVALID_MFA' where id = ?",
      w.conn,
    );
    withList("acc-chk", "acc-sav", "acc-new");
    const reset = await json(`/api/v1/bank-connections/${w.conn}/reset?budget_id=${w.plan}`, {
      method: "POST",
    });
    expect(reset.status).toBe(200);
    await syncOne(w.plan, w.conn);
    const list = await json(`/api/v1/bank-connections?budget_id=${w.plan}`);
    const conn = ((await data(list)).bank_connections as Json[]).find((c) => c.id === w.conn);
    const rewards = ((conn as Json).accounts as Json[]).find((x) => x.name === "ZZ Rewards");
    expect(rewards?.linked_account_id).toBeNull();
    const tool = tools.find((t) => t.name === "list_bank_connections");
    const out = (await tool?.run({ budget_id: w.plan } as never, { env } as never)) as {
      bank_connections: Json[];
    };
    const viaTool = out.bank_connections.find((c) => c.id === w.conn);
    expect(((viaTool as Json).accounts as Json[]).some((x) => x.name === "ZZ Rewards")).toBe(true);
  });

  it("14 an added bank account writes no history row", async () => {
    stubBank();
    const w = await world();
    withList("acc-chk", "acc-sav", "acc-new");
    const before = await logCount("bank_connection");
    await runSync(env, w.conn);
    expect(await logCount("bank_connection")).toBe(before);
    void linked;
  });
});
