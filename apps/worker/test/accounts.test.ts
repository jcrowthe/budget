import { env } from "cloudflare:test";
import { ACCOUNT_TYPES, DISPLAY_GROUPS, displayGroup } from "@budget/core/account-types";
import { AccountGroup } from "@budget/schema/accounts";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import * as accountsRepo from "../src/repositories/accounts";
import { addUnlinkedAccount, createAccount, NameTaken } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiDocument, apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const MONTH = "2026-11-01";
const NEXT_MONTH = "2026-12-01";

async function plan() {
  return (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
}
const base = (bid: string) => `/api/v1/budgets/${bid}/accounts`;
const post = (bid: string, body: unknown, headers: HeadersInit = {}) =>
  json(base(bid), { method: "POST", headers }, body);
async function month(bid: string, m: string) {
  const res = await json(`/api/v1/budgets/${bid}/months/${m}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { ready_to_assign: number; uncategorized: unknown } }).data;
}
const first = async <T>(sql: string, ...binds: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .first<T>();
const count = async (table: string, bid: string) =>
  (await first<{ n: number }>(`select count(*) n from ${table} where budget_id = ?`, bid))?.n;

describe("accounts surface", () => {
  it("lists its paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/accounts",
        "/api/v1/budgets/{budget_id}/accounts/{account_id}",
        "/api/v1/budgets/{budget_id}/account-summary",
      ]),
    );
    const paths = (await apiDocument()).paths as Record<string, Record<string, unknown>>;
    expect(paths["/api/v1/budgets/{budget_id}/accounts/{account_id}"]).toHaveProperty("patch");
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["list_accounts", "create_account", "get_account", "update_account"]),
    );
  });
});

describe("create account", () => {
  it("checking: Starting Balance feeds Ready to Assign", async () => {
    const bid = await plan();
    const before = await month(bid, MONTH);
    const res = await post(bid, {
      name: "  D3 Checking ",
      type: "checking",
      balance: 250000,
      date: DAY,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { account: Json; starting_balance: Json } };
    expect(data.account).toMatchObject({
      name: "D3 Checking",
      type: "checking",
      on_budget: true,
      starred: false,
      closed: false,
      cleared_balance: 250000,
      uncleared_balance: 0,
      balance: 250000,
    });
    const rows = await env.DB.prepare("select * from transactions where account_id = ?")
      .bind(data.account.id)
      .all<Json>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      date: DAY,
      payee_name: "Starting Balance",
      category_id: null,
      inflow_to_ready_to_assign: 1,
      amount: 250000,
      cleared: "cleared",
      approved: 1,
    });
    expect(data.starting_balance.id).toBe(rows.results[0].id);
    expect((await month(bid, MONTH)).ready_to_assign).toBe(before.ready_to_assign + 250000);
  });

  it("links every Starting Balance to the plan's one system payee", async () => {
    const bid = await plan();
    const first = (
      (await (
        await post(bid, { name: "A", type: "checking", balance: 1000, date: DAY })
      ).json()) as Json
    ).data;
    const second = (
      (await (
        await post(bid, { name: "B", type: "creditCard", balance: 1000, date: DAY })
      ).json()) as Json
    ).data;
    const sys = await env.DB.prepare(
      "select id from payees where budget_id = ? and system = 'starting_balance'",
    )
      .bind(bid)
      .all<{ id: string }>();
    expect(sys.results).toHaveLength(1);
    expect(first.starting_balance.payee_id).toBe(sys.results[0]?.id);
    expect(second.starting_balance.payee_id).toBe(sys.results[0]?.id);
    const logs = await env.DB.prepare(
      "select count(*) as n from change_log where budget_id = ? and entity_type = 'payee'",
    )
      .bind(bid)
      .first<{ n: number }>();
    expect(logs?.n).toBe(1);
  });

  it.each([
    ["creditCard", 150000, -150000],
    ["lineOfCredit", 5000, -5000],
  ])("%s: owed, uncategorised, no Ready to Assign change", async (type, entered, stored) => {
    const bid = await plan();
    const b1 = await month(bid, MONTH);
    const b2 = await month(bid, NEXT_MONTH);
    const res = await post(bid, { name: "Card", type, balance: entered, date: DAY });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Json };
    expect(data.account).toMatchObject({ on_budget: true, balance: stored });
    expect(data.starting_balance).toMatchObject({
      amount: stored,
      category_id: null,
      inflow_to_ready_to_assign: false,
    });
    const a1 = await month(bid, MONTH);
    const a2 = await month(bid, NEXT_MONTH);
    expect(a1.ready_to_assign).toBe(b1.ready_to_assign);
    expect(a2.ready_to_assign).toBe(b2.ready_to_assign);
    expect(a1.uncategorized).toEqual(b1.uncategorized);
  });

  it("tracking accounts and zero balances", async () => {
    const bid = await plan();
    const before = await month(bid, MONTH);
    const asset = (await (
      await post(bid, { name: "A", type: "otherAsset", balance: 5000000, date: DAY })
    ).json()) as Json;
    expect(asset.data.account).toMatchObject({ on_budget: false, balance: 5000000 });
    expect(asset.data.starting_balance).toMatchObject({ amount: 5000000, category_id: null });
    const liab = (await (
      await post(bid, { name: "L", type: "otherLiability", balance: 700000, date: DAY })
    ).json()) as Json;
    expect(liab.data.account).toMatchObject({ on_budget: false, balance: -700000 });
    const zero = (await (
      await post(bid, { name: "Z", type: "cash", balance: 0, date: DAY })
    ).json()) as Json;
    expect(zero.data.starting_balance.amount).toBe(0);
    expect(Object.is(zero.data.account.balance, 0)).toBe(true);
    expect((await month(bid, MONTH)).ready_to_assign).toBe(before.ready_to_assign);
    const rows = await first<{ n: number }>(
      "select count(*) n from transactions where account_id = ? and amount = 0",
      zero.data.account.id,
    );
    expect(rows?.n).toBe(1);
  });

  it("defaults the date to today (UTC)", async () => {
    const bid = await plan();
    const res = await post(bid, { name: "Today", type: "savings", balance: 1000 });
    const { data } = (await res.json()) as Json;
    expect(data.starting_balance.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("engine counting", () => {
  it("still counts a payee-less uncategorised credit transaction", async () => {
    const bid = await plan();
    const r = (await (
      await post(bid, { name: "Card", type: "creditCard", balance: 0, date: DAY })
    ).json()) as Json;
    const before = (await month(bid, NEXT_MONTH)).ready_to_assign;
    await env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, payee_name, amount, cleared, approved, inflow_to_ready_to_assign, created_at) values (?, ?, ?, ?, NULL, -40000, 'uncleared', 1, 0, ?)",
    )
      .bind(crypto.randomUUID(), bid, r.data.account.id, DAY, new Date().toISOString())
      .run();
    expect((await month(bid, NEXT_MONTH)).ready_to_assign).toBe(before - 40000);
  });
});

describe("read accounts", () => {
  it("lists in creation order, hides closed on request, gets one", async () => {
    const bid = await plan();
    const ids: string[] = [];
    for (const name of ["One", "Two", "Three"]) {
      const r = (await (
        await post(bid, { name, type: "checking", balance: 1000, date: DAY })
      ).json()) as Json;
      ids.push(r.data.account.id);
    }
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(ids[1]).run();
    const all = (await (await json(base(bid))).json()) as Json;
    expect(all.data.accounts.map((a: Json) => a.id)).toEqual(ids);
    const open = (await (await json(`${base(bid)}?include_closed=false`)).json()) as Json;
    expect(open.data.accounts.map((a: Json) => a.id)).toEqual([ids[0], ids[2]]);
    const one = await json(`${base(bid)}/${ids[1]}`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as Json).data.account).toMatchObject({
      id: ids[1],
      closed: true,
      balance: 1000,
    });
    expect((await json(`${base(bid)}/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await json(`${base(bid)}/not-a-uuid`)).status).toBe(404);
    expect((await json(base(crypto.randomUUID()))).status).toBe(404);
  });

  it("sums cleared and uncleared transactions", async () => {
    const bid = await plan();
    const r = (await (
      await post(bid, { name: "Bal", type: "checking", balance: 1000, date: DAY })
    ).json()) as Json;
    const id = r.data.account.id;
    await env.DB.prepare(
      "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, inflow_to_ready_to_assign, created_at) values (?, ?, ?, ?, -300, 'uncleared', 1, 0, ?)",
    )
      .bind(crypto.randomUUID(), bid, id, DAY, new Date().toISOString())
      .run();
    const a = ((await (await json(`${base(bid)}/${id}`)).json()) as Json).data.account;
    expect([a.cleared_balance, a.uncleared_balance, a.balance]).toEqual([1000, -300, 700]);
  });
});

describe("refusals", () => {
  it("rejects duplicate names in any case, closed ones included", async () => {
    const bid = await plan();
    const r = (await (
      await post(bid, { name: "D3 Savings", type: "savings", balance: 1, date: DAY })
    ).json()) as Json;
    for (const name of ["d3 savings", "  D3 SAVINGS "]) {
      const res = await post(bid, { name, type: "checking", balance: 1, date: DAY });
      expect(res.status).toBe(409);
      expect(((await res.json()) as Json).error).toMatchObject({
        name: "name_taken",
        detail: "This account name already exists.",
      });
    }
    await env.DB.prepare("update accounts set closed = 1 where id = ?")
      .bind(r.data.account.id)
      .run();
    expect((await post(bid, { name: "d3 savings", type: "cash", balance: 1 })).status).toBe(409);
    expect(await count("accounts", bid)).toBe(1);
    expect(await count("transactions", bid)).toBe(1);
  });

  it.each([
    [{ name: "M", type: "mortgage", balance: 1000 }, "oan"],
    [{ name: "M", type: "boat", balance: 1000 }, ""],
    [{ name: "  ", type: "checking", balance: 1000 }, ""],
    [{ name: "M", type: "checking", balance: 1.5 }, ""],
    [{ name: "M", type: "checking", balance: 1, date: "2026-02-30" }, ""],
  ])("422 for %j", async (body, detail) => {
    const bid = await plan();
    const res = await post(bid, body);
    expect(res.status).toBe(422);
    const err = ((await res.json()) as Json).error;
    expect(err.name).toBe("unprocessable_entity");
    expect(err.detail).toContain(detail);
    expect(await count("accounts", bid)).toBe(0);
  });
});

describe("MCP and history", () => {
  it("create_account matches REST and logs the actors", async () => {
    const bid = await plan();
    const rest = (await (
      await post(bid, { name: "R", type: "creditCard", balance: 150000, date: DAY })
    ).json()) as Json;
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const mcp = await mcpRpc(
      "tools/call",
      {
        name: "create_account",
        arguments: { budget_id: bid, name: "M", type: "creditCard", balance: 150000, date: DAY },
      },
      3,
    );
    const sc = mcp.body.result?.structuredContent as Json;
    const strip = ({ id, budget_id, account_id, name, created_at, sort, ...rest }: Json) => rest;
    expect(strip(sc.account)).toEqual(strip(rest.data.account));
    expect(strip(sc.starting_balance)).toEqual(strip(rest.data.starting_balance));
    const list = await mcpRpc(
      "tools/call",
      { name: "list_accounts", arguments: { budget_id: bid } },
      4,
    );
    const listed = list.body.result?.structuredContent as Json;
    expect(listed.accounts).toHaveLength(2);
    const log = await env.DB.prepare(
      "select entity_type, actor from change_log where budget_id = ? and entity_type in ('account','transaction') order by entity_type, actor",
    )
      .bind(bid)
      .all<{ entity_type: string; actor: string }>();
    expect(log.results).toHaveLength(4);
    for (const type of ["account", "transaction"]) {
      const actors = log.results.filter((r) => r.entity_type === type).map((r) => r.actor);
      expect(actors.some((a) => a.startsWith("user:"))).toBe(true);
      expect(actors.some((a) => a.startsWith("mcp:"))).toBe(true);
    }
  });

  it("replays an Idempotency-Key", async () => {
    const bid = await plan();
    const key = crypto.randomUUID();
    const body = { name: "Once", type: "checking", balance: 1000, date: DAY };
    const a = (await (await post(bid, body, { "Idempotency-Key": key })).json()) as Json;
    const b = (await (await post(bid, body, { "Idempotency-Key": key })).json()) as Json;
    expect(b.data.account.id).toBe(a.data.account.id);
    expect(await count("accounts", bid)).toBe(1);
  });
});

describe("atomicity", () => {
  it("leaves one account when five creates share a name", async () => {
    const bid = await plan();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        addUnlinkedAccount(env, actor, bid, { name: "Race", type: "checking", balance: 1000 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(NameTaken);
    }
    expect(await count("accounts", bid)).toBe(1);
    expect(await count("transactions", bid)).toBe(1);
    expect(await count("change_log", bid)).toBeGreaterThanOrEqual(2);
    const logs = await first<{ n: number }>(
      "select count(*) n from change_log where budget_id = ? and entity_type in ('account','transaction')",
      bid,
    );
    expect(logs?.n).toBe(2);
  });

  it("the guard changes nothing for a taken name", async () => {
    const bid = await plan();
    await addUnlinkedAccount(env, actor, bid, { name: "Taken", type: "checking", balance: 0 });
    const db = getDb(env);
    const row: accountsRepo.AccountRow = {
      id: crypto.randomUUID(),
      budgetId: bid,
      name: "TAKEN",
      type: "cash",
      onBudget: true,
      note: null,
      starred: false,
      closed: false,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    const [res] = await db.batch([
      accountsRepo.insertIfStmt(db, row, accountsRepo.newAccountGuard(db, bid, 1, row.name)),
    ]);
    expect(res.meta.changes).toBe(0);
  });
});

describe("minimal createAccount", () => {
  it("derives on_budget unless given", async () => {
    const bid = await plan();
    const a = await createAccount(env, actor, { budget_id: bid, name: "A", type: "otherAsset" });
    const b = await createAccount(env, actor, {
      budget_id: bid,
      name: "B",
      type: "otherAsset",
      on_budget: true,
    });
    expect([a.on_budget, b.on_budget]).toEqual([false, true]);
  });
});

describe("group", () => {
  it("the schema enum equals core's DISPLAY_GROUPS", () => {
    expect(AccountGroup.options).toEqual([...DISPLAY_GROUPS]);
  });

  it("is the same in REST and MCP for every type, open and closed", async () => {
    const bid = await plan();
    const ids = new Map<string, string>();
    for (const type of ACCOUNT_TYPES) {
      const a = await createAccount(env, actor, { budget_id: bid, name: `ZZ ${type}`, type });
      ids.set(a.id, type);
    }
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const both = async () => {
      const rest = (await (await json(base(bid))).json()) as Json;
      const mcp = await mcpRpc(
        "tools/call",
        { name: "list_accounts", arguments: { budget_id: bid } },
        5,
      );
      const sc = mcp.body.result?.structuredContent as Json;
      const listed = sc.accounts as Json[];
      return { rest: rest.data.accounts as Json[], mcp: listed };
    };
    const groups = (list: Json[]) => Object.fromEntries(list.map((a) => [a.id, a.group]));
    let r = await both();
    expect(r.rest).toHaveLength(13);
    expect(groups(r.mcp)).toEqual(groups(r.rest));
    for (const [id, type] of ids) {
      expect(groups(r.rest)[id]).toBe(displayGroup(type as never, false));
    }
    expect(new Set(Object.values(groups(r.rest)))).toEqual(
      new Set(["cash", "credit", "loans", "tracking"]),
    );
    const [starredId] = [...ids.keys()];
    await env.DB.prepare("UPDATE accounts SET starred = 1 WHERE id = ?").bind(starredId).run();
    r = await both();
    expect(groups(r.rest)[starredId as string]).toBe("cash");
    await env.DB.prepare("UPDATE accounts SET closed = 1 WHERE budget_id = ?").bind(bid).run();
    r = await both();
    expect(r.rest).toHaveLength(13);
    expect(Object.values(groups(r.rest)).every((g) => g === "closed")).toBe(true);
    expect(groups(r.mcp)).toEqual(groups(r.rest));
  });
});
