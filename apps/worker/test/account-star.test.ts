import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown, headers: HeadersInit = {}) =>
  json(path, { method, headers }, body);

async function account(bid: string, type = "checking", balance = 250000) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date: DAY,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}
const star = (bid: string, aid: string, body: unknown, headers: HeadersInit = {}) =>
  send(`/api/v1/budgets/${bid}/accounts/${aid}`, "PATCH", body, headers);
const logs = async (aid: string) =>
  (
    await env.DB.prepare(
      "select actor, action, before_json, after_json from change_log where entity_type = 'account' and entity_id = ? and action = 'update' order by rowid",
    )
      .bind(aid)
      .all<{ actor: string; action: string; before_json: string; after_json: string }>()
  ).results;
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
};
const summary = async (bid: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/account-summary`)).json()) as Json).data.balances;

describe("starring an account", () => {
  it("PATCH flips starred and logs each change with the actor", async () => {
    const bid = await plan();
    const aid = await account(bid);
    for (const starred of [true, false]) {
      const res = await star(bid, aid, { starred });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Json).data.account.starred).toBe(starred);
    }
    const rows = await logs(aid);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => JSON.parse(r.before_json).starred)).toEqual([false, true]);
    expect(rows.map((r) => JSON.parse(r.after_json).starred)).toEqual([true, false]);
    expect(rows.every((r) => r.actor === actor)).toBe(true);
  });

  it("a PATCH that changes nothing answers 200 and logs nothing", async () => {
    const bid = await plan();
    const aid = await account(bid);
    expect((await star(bid, aid, { starred: false })).status).toBe(200);
    expect(await logs(aid)).toHaveLength(0);
  });

  it("MCP update_account writes the same history shape; get_account equals REST", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const r = await mcp("update_account", { budget_id: bid, account_id: aid, starred: true });
    expect(r.result.structuredContent.account.starred).toBe(true);
    const rows = await logs(aid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor.startsWith("mcp:")).toBe(true);
    expect(Object.keys(JSON.parse(rows[0]?.after_json ?? "{}")).sort()).toEqual(
      Object.keys(
        ((await (await star(bid, aid, { starred: false })).json()) as Json).data.account,
      ).sort(),
    );
    const rest = ((await (await json(`/api/v1/budgets/${bid}/accounts/${aid}`)).json()) as Json)
      .data;
    const g = await mcp("get_account", { budget_id: bid, account_id: aid });
    expect(g.result.structuredContent).toEqual(rest);
  });

  it("a closed account cannot be starred but can be unstarred", async () => {
    const bid = await plan();
    const aid = await account(bid);
    await star(bid, aid, { starred: true });
    await env.DB.prepare("update accounts set closed = 1, starred = 0 where id = ?")
      .bind(aid)
      .run();
    const before = (await logs(aid)).length;
    const res = await star(bid, aid, { starred: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.detail).toContain("closed");
    expect((await logs(aid)).length).toBe(before);
    expect((await star(bid, aid, { starred: false })).status).toBe(200);
    const m = await mcp("update_account", { budget_id: bid, account_id: aid, starred: true });
    expect(m.result.isError).toBe(true);
  });

  it("answers 404 and 422", async () => {
    const bid = await plan();
    const other = await plan();
    const aid = await account(bid);
    const otherAcc = await account(other);
    expect((await star(crypto.randomUUID(), aid, { starred: true })).status).toBe(404);
    expect((await star(bid, crypto.randomUUID(), { starred: true })).status).toBe(404);
    expect((await star(bid, otherAcc, { starred: true })).status).toBe(404);
    expect((await star(bid, aid, {})).status).toBe(422);
    expect((await star(bid, aid, { name: "x" })).status).toBe(422);
    expect((await star(bid, aid, { starred: "yes" })).status).toBe(422);
  });

  it("an Idempotency-Key replay gives the same response and one history row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const key = { "Idempotency-Key": crypto.randomUUID() };
    const a = await star(bid, aid, { starred: true }, key);
    const b = await star(bid, aid, { starred: true }, key);
    expect(b.status).toBe(a.status);
    expect(await b.json()).toEqual(await a.json());
    expect(await logs(aid)).toHaveLength(1);
  });
});

describe("account summary", () => {
  it("sums the open accounts' balances and leaves out a closed one", async () => {
    const bid = await plan();
    await account(bid, "checking", 250000);
    await account(bid, "creditCard", 150000);
    await account(bid, "otherAsset", 5000000);
    const closed = await account(bid, "savings", 700000);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(closed).run();
    const list = (
      (await (await json(`/api/v1/budgets/${bid}/accounts`)).json()) as Json
    ).data.accounts.filter((a: Json) => !a.closed);
    const sum = (k: string) => list.reduce((n: number, a: Json) => n + a[k], 0);
    expect(await summary(bid)).toEqual({
      cleared: sum("cleared_balance"),
      uncleared: sum("uncleared_balance"),
      working: sum("balance"),
    });
    expect((await summary(bid)).working).toBe(5100000 - 0);
  });

  it("an account id is never read as 'summary'", async () => {
    const bid = await plan();
    const res = await json(`/api/v1/budgets/${bid}/accounts/summary`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Json).error.detail).toBe("Account not found");
    expect((await json(`/api/v1/budgets/${crypto.randomUUID()}/account-summary`)).status).toBe(404);
  });
});
