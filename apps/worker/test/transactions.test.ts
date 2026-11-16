import { env } from "cloudflare:test";
import { CREDIT_ACCOUNT_TYPES, STARTING_BALANCE_PAYEE } from "@budget/core/account-types";
import {
  REGISTER_CREDIT_TYPES,
  REGISTER_STARTING_PAYEE,
  sortTransactions,
} from "@budget/schema/register";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLogInsertIf } from "../src/history/change-log";
import * as txRepo from "../src/repositories/transactions";
import { createBudget } from "../src/services/budgets";
import { setAssigned } from "../src/services/months";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import { apiDocument, apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const MONTH = "2026-11-01";

const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown, headers: HeadersInit = {}) =>
  json(path, { method, headers }, body);

async function account(bid: string, type = "checking", balance = 500000) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date: DAY,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}
const list = async (bid: string, aid: string, query = "") => {
  const res = await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
};
const post = (bid: string, body: unknown, headers: HeadersInit = {}) =>
  send(`/api/v1/budgets/${bid}/transactions`, "POST", body, headers);
const patch = (bid: string, id: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions/${id}`, "PATCH", body);
const errName = async (res: Response) => ((await res.json()) as Json).error.name;
async function groceries(bid: string) {
  const m = (await (await json(`/api/v1/budgets/${bid}/months/${MONTH}`)).json()) as Json;
  const cat = m.data.groups
    .flatMap((g: Json) => g.categories)
    .find((c: Json) => c.name.endsWith("Groceries"));
  return cat.id as string;
}
const count = async (table: string, bid: string) =>
  (
    await env.DB.prepare(`select count(*) n from ${table} where budget_id = ?`)
      .bind(bid)
      .first<{ n: number }>()
  )?.n;
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  const r = await mcpRpc("tools/call", { name, arguments: args }, 2);
  return r.body as Json;
};

describe("surface", () => {
  it("lists its paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/accounts/{account_id}/transactions",
        "/api/v1/budgets/{budget_id}/transactions",
        "/api/v1/budgets/{budget_id}/transactions/{transaction_id}",
      ]),
    );
    const paths = (await apiDocument()).paths as Record<string, Record<string, unknown>>;
    expect(paths["/api/v1/budgets/{budget_id}/transactions"]).toHaveProperty("get");
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "list_transactions",
        "get_account_balances",
        "create_transaction",
        "update_transaction",
        "delete_transaction",
      ]),
    );
  });
  it("the register constants equal core's", () => {
    expect(REGISTER_CREDIT_TYPES).toEqual(CREDIT_ACCOUNT_TYPES);
    expect(REGISTER_STARTING_PAYEE).toBe(STARTING_BALANCE_PAYEE);
  });
});

describe("Starting Balance", () => {
  it("is the one cleared row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const d = await list(bid, aid);
    expect(d.transactions).toHaveLength(1);
    expect(d.transactions[0]).toMatchObject({
      payee_name: "Starting Balance",
      inflow_to_ready_to_assign: true,
      category_name: null,
      category_group_name: null,
      cleared: "cleared",
      amount: 500000,
    });
    expect(d.balances).toEqual({ cleared: 500000, uncleared: 0, working: 500000 });
  });
});

describe("worked example", () => {
  it("keeps the three balances at every step and the month figures", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const cat = await groceries(bid);
    await setAssigned(env, actor, {
      budget_id: bid,
      month: MONTH,
      category_id: cat,
      assigned: 200000,
    });
    const check = async (c: number, u: number, w: number) => {
      expect((await list(bid, aid)).balances).toEqual({ cleared: c, uncleared: u, working: w });
      const a = ((await (await json(`/api/v1/budgets/${bid}/accounts/${aid}`)).json()) as Json).data
        .account;
      expect([a.cleared_balance, a.uncleared_balance, a.balance]).toEqual([c, u, w]);
    };
    const out = await post(bid, { account_id: aid, date: DAY, amount: -17340, category_id: cat });
    expect(out.status).toBe(201);
    const outId = ((await out.json()) as Json).data.transaction.id;
    await check(500000, -17340, 482660);
    const inn = await post(bid, { account_id: aid, date: DAY, amount: 30000, category_id: cat });
    const inId = ((await inn.json()) as Json).data.transaction.id;
    await check(500000, 12660, 512660);
    expect((await patch(bid, outId, { amount: -20000 })).status).toBe(200);
    await check(500000, 10000, 510000);
    await patch(bid, inId, { cleared: "cleared" });
    await check(530000, -20000, 510000);
    await patch(bid, outId, { cleared: "cleared" });
    await check(510000, 0, 510000);
    await patch(bid, outId, { cleared: "uncleared" });
    await check(530000, -20000, 510000);

    const m = ((await (await json(`/api/v1/budgets/${bid}/months/${MONTH}`)).json()) as Json).data;
    const g = m.groups.flatMap((x: Json) => x.categories).find((c: Json) => c.id === cat);
    expect(g).toMatchObject({ activity: 10000, available: 210000 });
    expect(m.ready_to_assign).toBe(300000);
  });
});

describe("sorting and since_date", () => {
  it("the route orders like sortTransactions and since_date leaves the balances", async () => {
    const bid = await plan();
    const aid = await account(bid);
    for (const [payee, amount, date] of [
      ["ZZ Alpha", -25000, DAY],
      ["ZZ Beta", 10000, DAY],
      ["ZZ Gamma", -5000, "2026-10-01"],
    ] as const) {
      await post(bid, { account_id: aid, date, amount, payee_name: payee });
    }
    const base = await list(bid, aid);
    expect(base.transactions.map((t: Json) => t.payee_name)).toEqual([
      "ZZ Alpha",
      "ZZ Beta",
      "Starting Balance",
      "ZZ Gamma",
    ]);
    for (const sort of ["date", "payee", "category", "memo", "outflow", "inflow"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const d = await list(bid, aid, `?sort=${sort}&dir=${dir}`);
        expect(d.transactions).toEqual(sortTransactions(base.transactions, sort, dir));
      }
    }
    const since = await list(bid, aid, "?since_date=2026-11-01");
    expect(since.transactions).toHaveLength(3);
    expect(since.balances).toEqual(base.balances);
    const bad = await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions?sort=nope`);
    expect(bad.status).toBe(422);
  });
});

describe("REST = MCP, history", () => {
  it("the same list, balances and updated_at", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const created = (
      (await (await post(bid, { account_id: aid, date: DAY, amount: -1000 })).json()) as Json
    ).data.transaction;
    expect(created.updated_at >= created.created_at).toBe(true);
    const rest = await list(bid, aid);
    const m = await mcp("list_transactions", { budget_id: bid, account_id: aid });
    expect(m.result.structuredContent).toEqual(rest);
    const b = await mcp("get_account_balances", { budget_id: bid, account_id: aid });
    expect(b.result.structuredContent).toEqual(rest.balances);
    await new Promise((r) => setTimeout(r, 5));
    const up = ((await (await patch(bid, created.id, { memo: "x" })).json()) as Json).data
      .transaction;
    expect(up.updated_at > created.updated_at).toBe(true);
  });

  it("logs create, update and delete with the right actor, via REST and MCP", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = (
      (await (await post(bid, { account_id: aid, date: DAY, amount: -1000 })).json()) as Json
    ).data.transaction;
    await patch(bid, t.id, { amount: -2000 });
    const del = await send(`/api/v1/budgets/${bid}/transactions/${t.id}`, "DELETE");
    expect(del.status).toBe(200);
    const rows = (
      await env.DB.prepare(
        "select action, actor, before_json, after_json from change_log where entity_type='transaction' and entity_id=? order by created_at",
      )
        .bind(t.id)
        .all<Json>()
    ).results;
    expect(rows.map((r: Json) => [r.action, r.actor])).toEqual([
      ["create", actor],
      ["update", actor],
      ["delete", actor],
    ]);
    expect(JSON.parse(rows[1].before_json).amount).toBe(-1000);
    expect(JSON.parse(rows[1].after_json).amount).toBe(-2000);
    expect((await json(`/api/v1/budgets/${bid}/transactions/${t.id}`)).status).toBe(404);
    const d = await list(bid, aid);
    expect(d.transactions).toHaveLength(1);
    expect(d.balances.working).toBe(500000);

    const mc = await mcp("create_transaction", {
      budget_id: bid,
      account_id: aid,
      date: DAY,
      amount: -300,
    });
    const id = mc.result.structuredContent.transaction.id;
    await mcp("update_transaction", { budget_id: bid, transaction_id: id, amount: -400 });
    await mcp("delete_transaction", { budget_id: bid, transaction_id: id });
    const mrows = (
      await env.DB.prepare(
        "select action, actor from change_log where entity_type='transaction' and entity_id=? order by created_at",
      )
        .bind(id)
        .all<Json>()
    ).results;
    expect(mrows.map((r: Json) => r.action)).toEqual(["create", "update", "delete"]);
    for (const r of mrows) expect(r.actor.startsWith("mcp:")).toBe(true);
  });

  it("an Idempotency-Key replays a POST", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const key = crypto.randomUUID();
    const body = { account_id: aid, date: DAY, amount: -1000 };
    const a = await post(bid, body, { "Idempotency-Key": key });
    const b = await post(bid, body, { "Idempotency-Key": key });
    expect(await b.json()).toEqual(await a.json());
    expect(await count("transactions", bid)).toBe(2);
  });
});

describe("refusals", () => {
  const noChange = async (bid: string, tx: number | undefined, log: number | undefined) => {
    expect(await count("transactions", bid)).toBe(tx);
    expect(await count("change_log", bid)).toBe(log);
  };

  it("category rules on create", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const asset = await account(bid, "otherAsset", 5000000);
    const other = await plan();
    const otherCat = await groceries(other);
    const cat = await groceries(bid);
    const tx = await count("transactions", bid);
    const log = await count("change_log", bid);
    const bodies: [string, unknown][] = [
      ["other plan's category", { account_id: aid, date: DAY, amount: -1, category_id: otherCat }],
      ["category on asset", { account_id: asset, date: DAY, amount: -1, category_id: cat }],
      [
        "flag on asset",
        { account_id: asset, date: DAY, amount: 1, inflow_to_ready_to_assign: true },
      ],
      [
        "both",
        {
          account_id: aid,
          date: DAY,
          amount: 1,
          category_id: cat,
          inflow_to_ready_to_assign: true,
        },
      ],
      ["reconciled", { account_id: aid, date: DAY, amount: 1, cleared: "reconciled" }],
    ];
    for (const [label, body] of bodies) {
      const res = await post(bid, body);
      expect(res.status, label).toBe(422);
      expect(await errName(res)).toBe("unprocessable_entity");
    }
    await noChange(bid, tx, log);
  });

  it("reconciled rows cannot change or go", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const r = await createTransaction(env, actor, {
      budget_id: bid,
      account_id: aid,
      date: DAY,
      amount: -1000,
      cleared: "reconciled",
    });
    const tx = await count("transactions", bid);
    const log = await count("change_log", bid);
    const p = await patch(bid, r.id, { memo: "x" });
    expect(p.status).toBe(409);
    expect(await errName(p)).toBe("transaction_reconciled");
    const d = await send(`/api/v1/budgets/${bid}/transactions/${r.id}`, "DELETE");
    expect(d.status).toBe(409);
    await noChange(bid, tx, log);
  });

  it("a credit Starting Balance keeps its payee, category and account", async () => {
    const bid = await plan();
    const credit = await account(bid, "creditCard", 100000);
    const other = await account(bid);
    const cat = await groceries(bid);
    const sb = (await list(bid, credit)).transactions[0];
    const ordinary = (
      (await (
        await post(bid, { account_id: other, date: DAY, amount: 0, payee_name: "ZZ Other" })
      ).json()) as Json
    ).data.transaction.payee_id;
    for (const body of [
      { payee_name: "Other" },
      { payee_id: ordinary },
      { payee_id: null },
      { category_id: cat },
      { account_id: other },
    ]) {
      const res = await patch(bid, sb.id, body);
      expect(res.status).toBe(409);
      expect(await errName(res)).toBe("starting_balance_locked");
    }
    for (const body of [{ amount: -150000 }, { memo: "m" }, { cleared: "uncleared" }]) {
      expect((await patch(bid, sb.id, body)).status).toBe(200);
    }
    const res = await post(bid, {
      account_id: credit,
      date: DAY,
      amount: -1,
      payee_name: "Starting Balance",
    });
    // A typed "Starting Balance" is an ordinary payee, distinct from the system one.
    expect(res.status).toBe(201);
    const typed = ((await res.json()) as Json).data.transaction;
    expect(typed.payee_system).toBeNull();
    expect(typed.payee_id).not.toBe(sb.payee_id);
    const month = (await (await json(`/api/v1/budgets/${bid}/months/${MONTH}`)).json()) as Json;
    expect(month.data.uncategorized.activity).toBe(-1);
  });

  it("404s and moving between accounts", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const second = await account(bid, "savings", 100000);
    const other = await plan();
    const foreign = await account(other);
    const missing = crypto.randomUUID();
    expect((await json(`/api/v1/budgets/${missing}/accounts/${aid}/transactions`)).status).toBe(
      404,
    );
    expect((await json(`/api/v1/budgets/${bid}/accounts/${missing}/transactions`)).status).toBe(
      404,
    );
    expect((await json(`/api/v1/budgets/${bid}/transactions/${missing}`)).status).toBe(404);
    expect((await post(bid, { account_id: foreign, date: DAY, amount: 1 })).status).toBe(404);
    const t = (
      (await (await post(bid, { account_id: aid, date: DAY, amount: -5000 })).json()) as Json
    ).data.transaction;
    expect((await json(`/api/v1/budgets/${other}/transactions/${t.id}`)).status).toBe(404);
    expect((await patch(bid, t.id, { account_id: foreign })).status).toBe(404);
    expect((await patch(bid, t.id, {})).status).toBe(422);
    expect((await patch(bid, t.id, { account_id: second })).status).toBe(200);
    expect((await list(bid, aid)).balances.working).toBe(500000);
    expect((await list(bid, second)).balances.working).toBe(95000);
  });
});

describe("guards", () => {
  it("a stale guard changes nothing and logs nothing; concurrent patches settle", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = (
      (await (await post(bid, { account_id: aid, date: DAY, amount: -1000 })).json()) as Json
    ).data.transaction;
    const db = getDb(env);
    const stale = (await txRepo.findDetail(db, bid, t.id)) as txRepo.TransactionDetailRow;
    await patch(bid, t.id, { amount: -2000 });
    const log = await count("change_log", bid);
    const [, w] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: bid,
          actor,
          action: "update",
          entityType: "transaction",
          entityId: t.id,
          before: null,
          after: null,
        },
        txRepo.holds(db, stale),
      ),
      txRepo.updateIfHoldsStmt(db, stale, { ...stale, amount: -3000 }, new Date().toISOString()),
    ]);
    expect(w.meta.changes).toBe(0);
    expect(await count("change_log", bid)).toBe(log);

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => patch(bid, t.id, { amount: -n * 100 })),
    );
    for (const r of results) expect([200, 409]).toContain(r.status);
    const last = (
      await env.DB.prepare(
        "select after_json from change_log where entity_id=? order by created_at desc, rowid desc limit 1",
      )
        .bind(t.id)
        .first<{ after_json: string }>()
    )?.after_json;
    const row = ((await (await json(`/api/v1/budgets/${bid}/transactions/${t.id}`)).json()) as Json)
      .data.transaction;
    expect(JSON.parse(last as string).amount).toBe(row.amount);
  });
});
