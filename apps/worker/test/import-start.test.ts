import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { minusDays } from "../src/services/account-links";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  A,
  count,
  data,
  failingBatchEnv,
  feed,
  type Json,
  linked,
  q,
  REST_ACTOR,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  T,
  TX,
  world,
  world1,
} from "./plaid-sync-helpers";
import { mcpRpc } from "./surface";

beforeEach(setupPlaid);

const MCP_ACTOR = "mcp:user:tester@localhost";

const sbOf = async (account: string) =>
  (
    (
      await q(
        "select t.id from transactions t join payees p on p.id = t.payee_id where t.account_id = ? and p.system = 'starting_balance' and t.deleted_at is null",
        account,
      )
    )[0] as Json
  ).id as string;
const acc = async (plan: string, id: string) =>
  (await data(await json(`${A(plan)}/${id}`))).account as Json;
const moveTo = (plan: string, id: string, date: string, extra: Json = {}) =>
  json(`${TX(plan)}/${id}`, { method: "PATCH" }, { date, ...extra });
const accountLogs = (plan: string, id: string) =>
  q(
    "select actor, action, before_json, after_json from change_log where budget_id = ? and entity_type = 'account' and entity_id = ? order by created_at, rowid",
    plan,
    id,
  );
const day = (n: number) => minusDays(T, n);

/** Plaid amounts: positive is an outflow. */
const feedRows = () => [
  ...["r0", "r1", "r2", "r3"].map((id) =>
    plaidTxn({ transaction_id: `ZZ-${id}`, amount: 10, date: T }),
  ),
  ...(
    [
      ["o5", 1, 5],
      ["o15", 2, 15],
      ["o29", 3, 29],
      ["o30", 4, 30],
      ["o31", 5, 31],
      ["o45", 6, 45],
      ["o59", 7, 59],
    ] as const
  ).map(([id, amount, back]) => plaidTxn({ transaction_id: `ZZ-${id}`, amount, date: day(back) })),
];

describe("a linked Starting Balance's date moves the import start (EXF-774)", () => {
  it("1, 2: a full re-read, safely, with the history of the same batch", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const sb = await sbOf(account);
    feed.pages = [{ added: feedRows() }];
    const bal = async () => (await acc(plan, account)).balance;
    expect(await bal()).toBe(1250500);

    const s1 = await syncOne(plan, conn);
    expect([s1.added, s1.skipped]).toEqual([4, 7]);
    expect(await bal()).toBe(1210500);

    const byId = async (i: string) => (await rows(account)).find((r) => r.import_id === i) as Json;
    const [r0, r1, r2, r3] = [
      await byId("ZZ-r0"),
      await byId("ZZ-r1"),
      await byId("ZZ-r2"),
      await byId("ZZ-r3"),
    ];
    expect((await json(`${TX(plan)}/reject`, { method: "POST" }, { ids: [r0.id] })).status).toBe(
      200,
    );
    expect((await json(`${TX(plan)}/${r1.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json(`${TX(plan)}/approve`, { method: "POST" }, { ids: [r2.id] })).status).toBe(
      200,
    );
    const cat = (
      (await data(await json(`/api/v1/budgets/${plan}/months/${T.slice(0, 7)}-01`))) as Json
    ).groups.flatMap((g: Json) => g.categories)[0].id as string;
    expect((await moveTo(plan, r3.id, T, { category_id: cat })).status).toBe(200);
    expect(await bal()).toBe(1230500);
    const r2Before = await byId("ZZ-r2");
    const r3Before = await byId("ZZ-r3");

    const accLogsBefore = (await accountLogs(plan, account)).length;
    const res = await moveTo(plan, sb, day(30));
    expect(res.status).toBe(200);
    expect((await acc(plan, account)).import_start_date).toBe(day(30));
    // Same batch: one transaction update and one account update, the account's before T and after T-30.
    const al = await accountLogs(plan, account);
    expect(al).toHaveLength(accLogsBefore + 1);
    const last = al[al.length - 1] as Json;
    expect(last.actor).toBe(REST_ACTOR);
    expect(JSON.parse(last.before_json).import_start_date).toBe(T);
    expect(JSON.parse(last.after_json).import_start_date).toBe(day(30));
    expect(
      await count(
        "select count(*) n from change_log where entity_type = 'transaction' and entity_id = ? and action = 'update'",
        sb,
      ),
    ).toBe(1);

    const s2 = await syncOne(plan, conn);
    expect(s2.added).toBe(4);
    // 3 before_start (T-31, T-45, T-59) and 2 tombstoned (r0, r1)
    expect(s2.skipped).toBe(5);
    const dates = (await rows(account)).filter((r) => r.source === "plaid").map((r) => r.date);
    expect(dates.sort()).toEqual([day(30), day(29), day(15), day(5), T, T].sort());
    expect(await bal()).toBe(1220500);
    expect(await byId("ZZ-r2")).toEqual(r2Before);
    expect(await byId("ZZ-r3")).toEqual(r3Before);
    expect(await byId("ZZ-r0")).toBeUndefined();
    expect(await byId("ZZ-r1")).toBeUndefined();

    const s3 = await syncOne(plan, conn);
    expect(s3.added).toBe(0);
    expect(await bal()).toBe(1220500);
  });

  it("2: a batch that fails leaves the transaction and the account as they were", async () => {
    stubBank();
    const { plan, account } = await world1();
    const sb = await sbOf(account);
    const { updateTransaction } = await import("../src/services/transactions");
    const logTotal = () => count("select count(*) n from change_log where budget_id = ?", plan);
    const logsBefore = await logTotal();
    await expect(
      updateTransaction(failingBatchEnv(1), REST_ACTOR, plan, sb, { date: day(30) }),
    ).rejects.toThrow("simulated");
    expect((await acc(plan, account)).import_start_date).toBe(T);
    const row = (await q("select date from transactions where id = ?", sb))[0] as Json;
    expect(row.date).toBe(T);
    // No account and no transaction history row was added.
    expect(await logTotal()).toBe(logsBefore);
  });

  it("3: moved later keeps every imported row, the start follows, a later sync skips the gap", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const sb = await sbOf(account);
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-a", amount: 10, date: T })] }];
    expect((await syncOne(plan, conn)).added).toBe(1);
    const t2 = minusDays(T, -2);
    expect((await moveTo(plan, sb, t2)).status).toBe(200);
    expect((await acc(plan, account)).import_start_date).toBe(t2);
    expect((await rows(account)).filter((r) => r.source === "plaid")).toHaveLength(1);
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-a", amount: 10, date: T }),
          plaidTxn({ transaction_id: "ZZ-gap", amount: 5, date: minusDays(T, -1) }),
        ],
      },
    ];
    const s = await syncOne(plan, conn);
    expect(s.added).toBe(0);
    expect((await rows(account)).filter((r) => r.source === "plaid")).toHaveLength(1);
  });

  it("4: not linked, or no date move: no account history, the start is as it was", async () => {
    stubBank();
    const { plan, account } = await world1();
    const sb = await sbOf(account);
    const before = (await accountLogs(plan, account)).length;
    expect((await moveTo(plan, sb, T, { memo: "ZZ note" })).status).toBe(200);
    expect((await accountLogs(plan, account)).length).toBe(before);
    expect((await acc(plan, account)).import_start_date).toBe(T);

    const made = await data(
      await json(
        A(plan),
        { method: "POST" },
        { name: "ZZ Manual", type: "checking", balance: 0, date: T },
      ),
    );
    const mid = made.account.id as string;
    const logsBefore = (await accountLogs(plan, mid)).length;
    expect((await moveTo(plan, await sbOf(mid), day(20))).status).toBe(200);
    expect(await accountLogs(plan, mid)).toHaveLength(logsBefore);
    expect((await acc(plan, mid)).import_start_date).toBeNull();
  });

  it("5: linked later: a Starting Balance moved later but before the start keeps the start", async () => {
    stubBank();
    const { plan, bank } = await world();
    const made = await data(
      await json(
        A(plan),
        { method: "POST" },
        { name: "ZZ Old", type: "checking", balance: 0, date: day(60) },
      ),
    );
    const id = made.account.id as string;
    await createTransaction(env, REST_ACTOR, {
      budget_id: plan,
      account_id: id,
      date: day(20),
      amount: -1000,
      cleared: "reconciled",
      payee_name: "ZZ Shop",
    });
    const l = await json(
      `${A(plan)}/${id}/link`,
      { method: "POST" },
      { bank_account_id: bank["ZZ Checking"], today: T },
    );
    expect(l.status).toBe(200);
    const start = day(23);
    expect((await acc(plan, id)).import_start_date).toBe(start);
    expect((await moveTo(plan, await sbOf(id), day(40))).status).toBe(200);
    expect((await acc(plan, id)).import_start_date).toBe(start);
  });

  it("6: a deleted Starting Balance leaves the start", async () => {
    stubBank();
    const { plan, account } = await world1();
    const sb = await sbOf(account);
    expect((await json(`${TX(plan)}/${sb}`, { method: "DELETE" })).status).toBe(200);
    expect((await acc(plan, account)).import_start_date).toBe(T);
  });

  it("7: a reconciled Starting Balance needs confirm_reconciled; with it the start moves", async () => {
    stubBank();
    const { plan, account } = await world1();
    const sb = await sbOf(account);
    await env.DB.prepare("update transactions set cleared = 'reconciled' where id = ?")
      .bind(sb)
      .run();
    const refused = await moveTo(plan, sb, day(30));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Json).error.name).toBe("transaction_reconciled");
    expect((await acc(plan, account)).import_start_date).toBe(T);
    expect((await moveTo(plan, sb, day(30), { confirm_reconciled: true })).status).toBe(200);
    expect((await acc(plan, account)).import_start_date).toBe(day(30));
  });

  it("8: MCP update_transaction moves the start with an mcp actor; the descriptions say so", async () => {
    stubBank();
    const { plan, account } = await world1();
    const sb = await sbOf(account);
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const r = (
      await mcpRpc(
        "tools/call",
        {
          name: "update_transaction",
          arguments: { budget_id: plan, transaction_id: sb, date: day(30) },
        },
        2,
      )
    ).body.result as Json;
    expect(r.isError).not.toBe(true);
    expect((await acc(plan, account)).import_start_date).toBe(day(30));
    const al = await accountLogs(plan, account);
    expect((al[al.length - 1] as Json).actor).toBe(MCP_ACTOR);
    const tools = ((await mcpRpc("tools/list", {}, 3)).body.result as Json).tools as Json[];
    const text = (n: string) => tools.find((t) => t.name === n)?.description as string;
    expect(text("update_transaction")).toContain("widens the import");
    expect(text("create_accounts_from_bank")).toContain("today also sets import_start_date");
    expect(text("update_transaction")).toContain("Returns");
    expect(text("create_accounts_from_bank")).toContain("Returns");
  });
});
