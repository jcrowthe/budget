import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { bankBalanceToPlan } from "../src/plaid/amounts";
import * as accountsRepo from "../src/repositories/accounts";
import * as bankRepo from "../src/repositories/bank-connections";
import {
  minusDays,
  planAccountType,
  unlinkForConnectionStmts,
} from "../src/services/account-links";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import {
  ALL_SENTINELS,
  createPlan,
  type PlaidHandler,
  SENTINEL,
  seedSandboxCredentials,
  stubPlaid,
} from "./plaid-stub";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

type Json = Record<string, any>;
const T = "2026-03-10";
const REST_ACTOR = "user:tester@localhost";
const MCP_ACTOR = "mcp:user:tester@localhost";

let item = 0;
const plaid = (): Record<string, PlaidHandler> => ({
  "/item/public_token/exchange": () => ({
    body: { access_token: SENTINEL.accessToken, item_id: `item-links-${Date.now()}-${item++}` },
  }),
  "/accounts/get": () => ({
    body: {
      item: { institution_id: "ins_109508" },
      accounts: [
        ["acc-chk", "ZZ Checking", "depository", "checking", 1250.5],
        ["acc-sav", "ZZ Savings", "depository", "savings", 300],
        ["acc-cc", "ZZ Card", "credit", "credit card", 420.25],
        ["acc-ln", "ZZ Student Loan", "loan", "student", null],
      ].map(([account_id, name, type, subtype, current]) => ({
        account_id,
        name,
        mask: "0000",
        type,
        subtype,
        balances: { current, available: null },
      })),
    },
  }),
  "/institutions/get_by_id": () => ({
    body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
  }),
  "/item/remove": () => ({ body: { removed: true } }),
});

const data = async (res: Response) => ((await res.json()) as Json).data;
const clean = (text: string) => ALL_SENTINELS.every((s) => !text.includes(s));
const count = async (sql: string, ...b: string[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .first<{ n: number }>()
  )?.n;

async function setup(environment: "sandbox" | "production" = "sandbox") {
  const plan = await createPlan(environment);
  return { plan };
}

/** A sandbox plan with a connection; `bank` maps the bank account's plaid id to its row id. */
async function connect(plan: string) {
  const res = await json(
    "/api/v1/bank-connections",
    { method: "POST" },
    { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
  );
  expect(res.status).toBe(201);
  const conn = (await data(res)).bank_connection ?? (await data(res));
  return conn as Json;
}

async function world() {
  const plan = await createPlan("sandbox");
  const conn = await connect(plan);
  const bank: Json = {};
  for (const a of conn.accounts as Json[]) bank[a.name as string] = a.id as string;
  return { plan, conn, bank };
}

const A = (plan: string) => `/api/v1/budgets/${plan}/accounts`;
const fromBank = (plan: string, body: Json) =>
  json(`${A(plan)}/from-bank`, { method: "POST" }, body);
const link = (plan: string, id: string, body: Json) =>
  json(`${A(plan)}/${id}/link`, { method: "POST" }, body);
const unlink = (plan: string, id: string) => json(`${A(plan)}/${id}/link`, { method: "DELETE" });
const getAcc = async (plan: string, id: string) =>
  (await data(await json(`${A(plan)}/${id}`))).account as Json;
const manual = async (plan: string, name: string, type = "checking") =>
  (await data(await json(A(plan), { method: "POST" }, { name, type, balance: 0, date: T }))).account
    .id as string;
const txCount = (account: string) =>
  count("select count(*) n from transactions where account_id = ? and deleted_at is null", account);
const logs = async (plan: string, entity: string) =>
  (
    await env.DB.prepare(
      "select actor, action, entity_type, budget_id from change_log where budget_id = ? and entity_type = ? order by created_at, rowid",
    )
      .bind(plan, entity)
      .all<Json>()
  ).results;

async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

describe("account links", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid(plaid());
  });

  it("1-2: from-bank creates linked accounts with Starting Balances", async () => {
    const { plan, bank } = await world();
    const res = await fromBank(plan, {
      bank_account_ids: [bank["ZZ Checking"], bank["ZZ Card"]],
      today: T,
    });
    expect(res.status).toBe(201);
    const { created } = await data(res);
    expect(created.map((c: Json) => c.account.type)).toEqual(["checking", "creditCard"]);
    expect(created.map((c: Json) => c.account.name)).toEqual(["ZZ Checking", "ZZ Card"]);
    const listed = (await tool("list_accounts", { budget_id: plan })).structuredContent as Json;
    for (const [i, id] of [bank["ZZ Checking"], bank["ZZ Card"]].entries()) {
      const a = listed.accounts.find((x: Json) => x.id === created[i].account.id);
      expect(a).toMatchObject({ linked: true, bank_account_id: id, import_start_date: T });
    }
    const [chk, card] = created;
    expect(chk.starting_balance).toMatchObject({
      payee_name: "Starting Balance",
      date: T,
      cleared: "cleared",
      approved: true,
      amount: 1250500,
      inflow_to_ready_to_assign: true,
    });
    expect(card.starting_balance).toMatchObject({ amount: -420250, date: T, cleared: "cleared" });
    expect(card.starting_balance.payee_id).toBe(chk.starting_balance.payee_id);
    expect(await txCount(chk.account.id)).toBe(1);
    expect(chk.account.balance).toBe(1250500);
    const ln = await fromBank(plan, { bank_account_ids: [bank["ZZ Student Loan"]], today: T });
    const lc = (await data(ln)).created[0];
    expect(lc.account.type).toBe("studentLoan");
    expect(lc.starting_balance.amount).toBe(0);
    const rows = await logs(plan, "account");
    expect(rows.every((r) => r.actor === REST_ACTOR && r.action === "create")).toBe(true);
    expect(
      await count(
        "select count(*) n from change_log where entity_type='payee' and budget_id = ?",
        plan,
      ),
    ).toBe(1);
  });

  it("3: overrides change name and type; bad overrides create nothing", async () => {
    const { plan, bank } = await world();
    const sav = bank["ZZ Savings"];
    const ok = await fromBank(plan, {
      bank_account_ids: [sav],
      overrides: { [sav]: { name: "ZZ Rainy Day", type: "checking" } },
      today: T,
    });
    expect(ok.status).toBe(201);
    expect((await data(ok)).created[0].account).toMatchObject({
      name: "ZZ Rainy Day",
      type: "checking",
    });
    const cash = await fromBank(plan, {
      bank_account_ids: [bank["ZZ Card"]],
      overrides: { [bank["ZZ Card"]]: { type: "cash" } },
    });
    expect(cash.status).toBe(422);
    expect(((await cash.json()) as Json).error.name ?? "").toBeTruthy();
    const stray = await fromBank(plan, {
      bank_account_ids: [bank["ZZ Card"]],
      overrides: { [sav]: { name: "x" } },
    });
    expect(stray.status).toBe(422);
    expect(await count("select count(*) n from accounts where budget_id = ?", plan)).toBe(1);
  });

  it("4-5: link an existing account; cash and closed are refused", async () => {
    const { plan, bank } = await world();
    const a = await manual(plan, "ZZ Old");
    for (const [date, cleared] of [
      ["2026-03-02", "reconciled"],
      ["2026-03-05", "cleared"],
    ] as const) {
      await createTransaction(env, REST_ACTOR, {
        budget_id: plan,
        account_id: a,
        date,
        amount: -1000,
        cleared,
        payee_name: "ZZ Shop",
      });
    }
    const before = await txCount(a);
    const res = await link(plan, a, { bank_account_id: bank["ZZ Checking"], today: T });
    expect(res.status).toBe(200);
    expect((await data(res)).account).toMatchObject({
      linked: true,
      bank_account_id: bank["ZZ Checking"],
      import_start_date: "2026-02-27",
    });
    expect(await txCount(a)).toBe(before);
    const b = await manual(plan, "ZZ Fresh");
    const r2 = await link(plan, b, { bank_account_id: bank["ZZ Savings"], today: T });
    expect((await data(r2)).account.import_start_date).toBe(T);
    const c = await manual(plan, "ZZ Third");
    const r3 = await link(plan, c, { bank_account_id: bank["ZZ Card"] });
    expect((await data(r3)).account.import_start_date).toBe(new Date().toISOString().slice(0, 10));
    const cash = await manual(plan, "ZZ Wallet", "cash");
    const rc = await link(plan, cash, { bank_account_id: bank["ZZ Student Loan"] });
    expect(rc.status).toBe(422);
    expect(((await rc.json()) as Json).error.name).toBe("account_not_linkable");
    const d = await manual(plan, "ZZ Shut");
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(d).run();
    const rd = await link(plan, d, { bank_account_id: bank["ZZ Student Loan"] });
    expect(rd.status).toBe(422);
    expect(((await rd.json()) as Json).error.name).toBe("account_not_linkable");
    const logged = (await logs(plan, "account")).filter((r) => r.action === "update");
    expect(logged).toHaveLength(3);
  });

  it("6: unlink keeps transactions and frees the bank account", async () => {
    const { plan, conn, bank } = await world();
    const created = (
      await data(await fromBank(plan, { bank_account_ids: [bank["ZZ Checking"]], today: T }))
    ).created[0].account;
    const shown = async () =>
      (
        await data(await json(`/api/v1/bank-connections/${conn.id}?budget_id=${plan}`))
      ).bank_connection.accounts.find((x: Json) => x.id === bank["ZZ Checking"]).linked_account_id;
    expect(await shown()).toBe(created.id);
    const res = await unlink(plan, created.id);
    expect(res.status).toBe(200);
    expect((await data(res)).account).toMatchObject({
      linked: false,
      bank_account_id: null,
      import_start_date: null,
    });
    expect(await txCount(created.id)).toBe(1);
    expect(await shown()).toBeNull();
    const n = (await logs(plan, "account")).length;
    expect((await unlink(plan, created.id)).status).toBe(200);
    expect((await logs(plan, "account")).length).toBe(n);
    expect(
      (await link(plan, created.id, { bank_account_id: bank["ZZ Checking"], today: T })).status,
    ).toBe(200);
  });

  it("7: one bank account per plan account and per plan; free in another plan", async () => {
    const { plan, bank } = await world();
    const chk = bank["ZZ Checking"];
    const first = (await data(await fromBank(plan, { bank_account_ids: [chk], today: T })))
      .created[0].account;
    const other = await manual(plan, "ZZ Other");
    const dup = await link(plan, other, { bank_account_id: chk });
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as Json;
    expect(body.error.name).toBe("bank_account_already_linked");
    expect(JSON.stringify(body)).toContain(first.name);
    const twice = await link(plan, first.id, { bank_account_id: bank["ZZ Savings"] });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as Json).error.name).toBe("account_already_linked");
    const before = await count("select count(*) n from accounts where budget_id = ?", plan);
    const again = await fromBank(plan, { bank_account_ids: [bank["ZZ Savings"], chk] });
    expect(again.status).toBe(409);
    expect(await count("select count(*) n from accounts where budget_id = ?", plan)).toBe(before);
    const plan2 = await createPlan("sandbox");
    expect((await fromBank(plan2, { bank_account_ids: [chk], today: T })).status).toBe(201);
    // the unique index is the backstop
    await expect(
      env.DB.prepare("update accounts set bank_account_id = ? where id = ?").bind(chk, other).run(),
    ).rejects.toThrow(/accounts_bank_account_link|UNIQUE/);
  });

  it("8: MCP tools match REST and log an mcp actor", async () => {
    const { plan, bank } = await world();
    const res = await tool("create_accounts_from_bank", {
      budget_id: plan,
      bank_account_ids: [bank["ZZ Checking"]],
      today: T,
    });
    const acc = (res.structuredContent as Json).created[0].account;
    expect(acc).toMatchObject({ linked: true, import_start_date: T });
    const un = await tool("unlink_account", { budget_id: plan, account_id: acc.id });
    expect((un.structuredContent as Json).account.linked).toBe(false);
    const re = await tool("link_account", {
      budget_id: plan,
      account_id: acc.id,
      bank_account_id: bank["ZZ Checking"],
      today: T,
    });
    expect((re.structuredContent as Json).account.linked).toBe(true);
    for (const e of ["account", "transaction", "payee"]) {
      const rows = await logs(plan, e);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.actor === MCP_ACTOR)).toBe(true);
    }
    const dup = await tool("create_accounts_from_bank", {
      budget_id: plan,
      bank_account_ids: [bank["ZZ Checking"]],
    });
    expect(dup.isError).toBe(true);
    const cashPlan = await tool("link_account", {
      budget_id: plan,
      account_id: crypto.randomUUID(),
      bank_account_id: bank["ZZ Card"],
    });
    expect(cashPlan.isError).toBe(true);
    expect(clean(JSON.stringify(res))).toBe(true);
  });

  it("9: removing a connection unlinks accounts in every plan, atomically", async () => {
    const { plan, conn, bank } = await world();
    const plan2 = await createPlan("sandbox");
    const a1 = (
      await data(await fromBank(plan, { bank_account_ids: [bank["ZZ Checking"]], today: T }))
    ).created[0].account.id;
    const a2 = (
      await data(await fromBank(plan2, { bank_account_ids: [bank["ZZ Card"]], today: T }))
    ).created[0].account.id;
    stubPlaid({
      ...plaid(),
      "/item/remove": () => ({ status: 500, body: { error_code: "INTERNAL_SERVER_ERROR" } }),
    });
    const failed = await json(`/api/v1/bank-connections/${conn.id}?budget_id=${plan}`, {
      method: "DELETE",
    });
    expect(failed.status).toBe(502);
    expect((await getAcc(plan, a1)).linked).toBe(true);
    stubPlaid(plaid());
    const ok = await json(`/api/v1/bank-connections/${conn.id}?budget_id=${plan}`, {
      method: "DELETE",
    });
    expect(ok.status).toBe(200);
    for (const [p, a] of [
      [plan, a1],
      [plan2, a2],
    ] as const) {
      expect(await getAcc(p, a)).toMatchObject({ linked: false, import_start_date: null });
      expect(await txCount(a)).toBe(1);
      expect((await logs(p, "account")).filter((r) => r.action === "update")).toHaveLength(1);
    }
  });

  it("9b: a link made between the read and the removal batch is not lost unlogged", async () => {
    const { plan, conn, bank } = await world();
    const a1 = (
      (await data(
        await fromBank(plan, { bank_account_ids: [bank["ZZ Checking"]], today: T }),
      )) as Json
    ).created[0].account.id as string;
    const a2 = await manual(plan, "ZZ Late");
    const db = getDb(env);
    const unlink = await unlinkForConnectionStmts(db, REST_ACTOR, conn.id);
    // a link commits after the read and before the batch
    expect((await link(plan, a2, { bank_account_id: bank["ZZ Savings"], today: T })).status).toBe(
      200,
    );
    const holds = bankRepo.removalHolds(
      db,
      conn.id,
      accountsRepo.noOtherLinks(conn.id, unlink.ids),
    );
    await db.batch([
      ...unlink.stmts,
      bankRepo.deleteAccountsStmt(db, conn.id, holds),
      bankRepo.deleteConnectionStmt(db, conn.id, holds),
    ] as unknown as Parameters<typeof db.batch>[0]);
    // the stale batch removed nothing and did not clear the late link
    expect(await count("select count(*) n from bank_connections where id = ?", conn.id)).toBe(1);
    expect(
      await count("select count(*) n from bank_accounts where bank_connection_id = ?", conn.id),
    ).toBe(4);
    expect((await getAcc(plan, a2)).linked).toBe(true);
    expect((await getAcc(plan, a1)).linked).toBe(false);
    // the real removal retries from a fresh read and logs every unlink
    const ok = await json(`/api/v1/bank-connections/${conn.id}?budget_id=${plan}`, {
      method: "DELETE",
    });
    expect(ok.status).toBe(200);
    expect((await getAcc(plan, a2)).linked).toBe(false);
    const updates = (await logs(plan, "account")).filter((r) => r.action === "update");
    // a1 unlinked once; a2 linked once and unlinked once
    expect(updates).toHaveLength(3);
    expect(
      await count(
        "select count(*) n from accounts where budget_id = ? and bank_account_id is not null",
        plan,
      ),
    ).toBe(0);
  });

  it("a blank Plaid name gets a non-empty default", async () => {
    const { plan, bank } = await world();
    await env.DB.prepare("update bank_accounts set name = '   ', mask = '1234' where id = ?")
      .bind(bank["ZZ Savings"])
      .run();
    const res = await fromBank(plan, { bank_account_ids: [bank["ZZ Savings"]], today: T });
    expect(res.status).toBe(201);
    expect((await data(res)).created[0].account.name).toBe("savings 1234");
  });

  it("10: another environment's bank account is not found; unlink always works", async () => {
    const { plan, bank } = await world();
    const prod = await createPlan("production");
    const acc = await manual(prod, "ZZ Prod");
    const accounts = await count("select count(*) n from accounts where budget_id = ?", prod);
    const logsBefore = await count("select count(*) n from change_log where budget_id = ?", prod);
    const r1 = await fromBank(prod, { bank_account_ids: [bank["ZZ Checking"]] });
    const r2 = await link(prod, acc, { bank_account_id: bank["ZZ Checking"] });
    expect([r1.status, r2.status]).toEqual([404, 404]);
    expect(await count("select count(*) n from accounts where budget_id = ?", prod)).toBe(accounts);
    expect(await count("select count(*) n from change_log where budget_id = ?", prod)).toBe(
      logsBefore,
    );
    const made = (
      await data(await fromBank(plan, { bank_account_ids: [bank["ZZ Checking"]], today: T }))
    ).created[0].account.id;
    const sw = await json(
      `/api/v1/budgets/${plan}`,
      { method: "PATCH" },
      { bank_environment: "production" },
    );
    expect(sw.status).toBe(200);
    const res = await unlink(plan, made);
    expect(res.status).toBe(200);
    expect((await data(res)).account.linked).toBe(false);
  });

  it("11: the surface lists the paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/accounts/from-bank",
        "/api/v1/budgets/{budget_id}/accounts/{account_id}/link",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["create_accounts_from_bank", "link_account", "unlink_account"]),
    );
  });

  it("12: pure functions", () => {
    const cases: [string, string | null, string][] = [
      ["depository", "checking", "checking"],
      ["depository", "savings", "savings"],
      ["depository", "money market", "savings"],
      ["depository", "cd", "savings"],
      ["depository", "hsa", "savings"],
      ["depository", "prepaid", "checking"],
      ["depository", null, "checking"],
      ["credit", "credit card", "creditCard"],
      ["credit", null, "creditCard"],
      ["loan", "mortgage", "mortgage"],
      ["loan", "auto", "autoLoan"],
      ["loan", "student", "studentLoan"],
      ["loan", "home equity", "personalLoan"],
      ["loan", null, "personalLoan"],
      ["investment", "ira", "otherAsset"],
      ["brokerage", null, "otherAsset"],
      ["other", null, "otherAsset"],
      ["mystery", "x", "otherAsset"],
    ];
    for (const [t, s, want] of cases) expect(planAccountType(t, s)).toBe(want);
    expect(bankBalanceToPlan("depository", 125050)).toBe(125050);
    expect(bankBalanceToPlan("credit", 42025)).toBe(-42025);
    expect(Object.is(bankBalanceToPlan("loan", 0), 0)).toBe(true);
    expect(bankBalanceToPlan("credit", null)).toBe(0);
    expect(minusDays("2026-03-02", 3)).toBe("2026-02-27");
  });
});
