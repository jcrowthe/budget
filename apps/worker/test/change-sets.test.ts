import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { setAssigned } from "../src/services/months";
import { account, DAY, send as sendTo } from "./account-helpers";
import { api, type Json, type Month, month, plan, send } from "./category-helpers";
import { json } from "./helpers";
import { reconcile, seedWorkedExample } from "./reconcile-helpers";

type Cat = { id: string };
const cats = (m: Month): Cat[] => m.groups.flatMap((g) => g.categories);
const HEADER = "Budget-Change-Set";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOV = "2026-11-01";
const actor = "user:tester@localhost";

type Row = { entity_type: string; entity_id: string; action: string; change_set_id: string | null };
async function rowsOf(setId: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    "select entity_type, entity_id, action, change_set_id from change_log where change_set_id = ?",
  )
    .bind(setId)
    .all<Row>();
  return results;
}
async function rowsFor(bid: string, type?: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    "select entity_type, entity_id, action, change_set_id from change_log where budget_id = ?",
  )
    .bind(bid)
    .all<Row>();
  return type ? results.filter((r) => r.entity_type === type) : results;
}
function setId(res: Response): string {
  const id = res.headers.get(HEADER);
  expect(id).toMatch(UUID);
  return id as string;
}

describe("change sets (acc. 1)", () => {
  it("PATCH an Assigned value: header is a UUID and the row carries it", async () => {
    const bid = await plan();
    const c = cats(await month(bid, NOV))[0] as Cat;
    const res = await send("PATCH", api(bid, `/months/${NOV}/categories/${c.id}`), {
      assigned: 400000,
    });
    expect(res.status).toBe(200);
    const id = setId(res);
    const rows = await rowsFor(bid, "month_category");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.change_set_id).toBe(id);
  });
});

describe("change sets (acc. 2)", () => {
  it("a transfer's rows share one id; the next request gets another", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 100000);
    const b = await account(bid, "savings", 0);
    const post = () =>
      sendTo(`/api/v1/budgets/${bid}/transactions`, "POST", {
        account_id: a.id,
        date: DAY,
        amount: -1000,
        transfer_account_id: b.id,
      });
    const r1 = await post();
    expect(r1.status).toBe(201);
    const id1 = setId(r1);
    const t = ((await r1.json()) as Json).data.transaction;
    const mine = (await rowsOf(id1)).filter((r) => r.entity_type === "transaction");
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const all = await rowsFor(bid, "transaction");
    const ours = all.filter(
      (r) => r.entity_id === t.id || r.entity_id === t.transfer_transaction_id,
    );
    expect(ours.length).toBeGreaterThanOrEqual(2);
    for (const r of ours) expect(r.change_set_id).toBe(id1);
    const r2 = await post();
    expect(setId(r2)).not.toBe(id1);
  });
});

describe("change sets (acc. 3): raw sites", () => {
  it("logSelectStmt: category delete with reassign_to", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const from = (cats(m)[0] as Cat).id;
    const to = (cats(m)[1] as Cat).id;
    const a = await account(bid, "checking", 0);
    const t = await sendTo(`/api/v1/budgets/${bid}/transactions`, "POST", {
      account_id: a.id,
      date: DAY,
      amount: -500,
      category_id: from,
    });
    expect(t.status).toBe(201);
    const res = await send("DELETE", api(bid, `/categories/${from}?reassign_to=${to}`));
    expect(res.status).toBe(200);
    const rows = await rowsOf(setId(res));
    expect(rows.filter((r) => r.entity_type === "transaction").length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.entity_type === "category" && r.entity_id === from)).toBe(true);
  });

  it("reconcileLogsStmt: a reconcile", async () => {
    const w = await seedWorkedExample();
    const res = await reconcile(w.b, w.checking, { statement_balance: 755500 });
    expect(res.status).toBe(200);
    const rows = await rowsOf(setId(res));
    const upd = rows.filter((r) => r.entity_type === "transaction" && r.action === "update");
    expect(upd.length).toBeGreaterThanOrEqual(4);
    expect(upd.some((r) => r.entity_id === w.fuel)).toBe(true);
  });

  it("credit-payments: a credit-card account create", async () => {
    const bid = await plan();
    const res = await sendTo(`/api/v1/budgets/${bid}/accounts`, "POST", {
      name: "ZZ Card",
      type: "creditCard",
      balance: 0,
      date: DAY,
    });
    expect(res.status).toBe(201);
    const rows = await rowsOf(setId(res));
    expect(rows.some((r) => r.entity_type === "category_group" && r.action === "create")).toBe(
      true,
    );
    expect(rows.some((r) => r.entity_type === "category" && r.action === "create")).toBe(true);
  });
});

describe("change sets (acc. 4)", () => {
  it("an MCP tool call that writes stamps its rows", async () => {
    const bid = await plan();
    const c = cats(await month(bid, NOV))[0] as Cat;
    const headers = async () => {
      const { localToken } = await import("./helpers");
      return {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Cf-Access-Jwt-Assertion": await localToken(),
        Host: "localhost",
      };
    };
    const rpc = async (method: string, params: unknown, id: number) => {
      const { call } = await import("./helpers");
      return call("/mcp", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    };
    await (
      await rpc(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
        1,
      )
    ).text();
    const res = await rpc(
      "tools/call",
      {
        name: "set_assigned",
        arguments: { budget_id: bid, month: NOV, category_id: c.id, assigned: 1000 },
      },
      2,
    );
    expect(res.status).toBe(200);
    const id = setId(res);
    await res.text();
    const rows = await rowsOf(id);
    expect(rows.some((r) => r.entity_type === "month_category")).toBe(true);
    const { results } = await env.DB.prepare("select actor from change_log where change_set_id = ?")
      .bind(id)
      .all<{ actor: string }>();
    for (const r of results) expect(r.actor.startsWith("mcp:")).toBe(true);
  });

  it("a GET has no header", async () => {
    const bid = await plan();
    const res = await json(`/api/v1/budgets/${bid}/months/${NOV}`);
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it("rows written outside a request have a null change_set_id", async () => {
    const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
    const c = cats(await month(b.id, NOV))[0] as Cat;
    await setAssigned(env, actor, { budget_id: b.id, month: NOV, category_id: c.id, assigned: 5 });
    const rows = await rowsFor(b.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.change_set_id).toBeNull();
  });

  it("a 4xx write has no header", async () => {
    const bid = await plan();
    const res = await send("PATCH", api(bid, `/months/${NOV}/categories/${crypto.randomUUID()}`), {
      assigned: 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it("an idempotent replay carries no header", async () => {
    const bid = await plan();
    const c = cats(await month(bid, NOV))[0] as Cat;
    const go = async () =>
      json(
        api(bid, `/months/${NOV}/categories/${c.id}`),
        { method: "PATCH", headers: { "Idempotency-Key": "k-change-set-1" } },
        { assigned: 700 },
      );
    const first = await go();
    expect(first.status).toBe(200);
    setId(first);
    const again = await go();
    expect(again.status).toBe(200);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.headers.get(HEADER)).toBeNull();
  });
});
