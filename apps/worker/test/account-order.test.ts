import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { A, account, data, plan, send, USER } from "./account-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const MCP = `mcp:${USER}`;
const toolData = (r: Json) => JSON.parse(r.content[0].text);

async function callTool(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

const put = (bid: string, ids: string[]) => send(`${A(bid)}/order`, "PUT", { account_ids: ids });
const sortsOf = async (bid: string) => {
  const { results } = await env.DB.prepare(
    "select id, sort_order from accounts where budget_id = ? and deleted_at is null",
  )
    .bind(bid)
    .all<{ id: string; sort_order: number }>();
  return new Map(results.map((r) => [r.id, r.sort_order]));
};
const listIds = async (bid: string, group = "cash") =>
  ((await data(await send(A(bid), "GET"))).accounts as Json[])
    .filter((a) => a.group === group)
    .map((a) => a.id as string);
const logCount = async (bid: string) =>
  (
    await env.DB.prepare(
      "select count(*) as n from change_log where budget_id = ? and action = 'update' and entity_type = 'account'",
    )
      .bind(bid)
      .first<{ n: number }>()
  )?.n;

/** Three CASH accounts, one CREDIT, one LOAN. */
async function world() {
  const bid = await plan();
  const [a, b, c] = [
    await account(bid, "checking"),
    await account(bid, "savings"),
    await account(bid, "cash"),
  ];
  const credit = await account(bid, "creditCard");
  const loanRes = await send(A(bid), "POST", {
    name: "ZZ loan",
    type: "mortgage",
    balance: 100000,
    interest_rate: "6.5",
    minimum_payment: 1000,
    date: "2026-11-10",
  });
  expect(loanRes.status).toBe(201);
  const loan = (await data(loanRes)).account as Json;
  return {
    bid,
    a: a.id as string,
    b: b.id as string,
    c: c.id as string,
    credit: credit.id as string,
    loan: loan.id as string,
  };
}

describe("PUT accounts/order", () => {
  it("lists the path and the tool", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/accounts/order");
    expect(await listedToolNames()).toContain("reorder_accounts");
  });

  it("reorders one section, leaves the others and the max sort alone", async () => {
    const w = await world();
    const before = await sortsOf(w.bid);
    const res = await put(w.bid, [w.c, w.a, w.b]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    const resp = (body.data.accounts as Json[]).filter((x) => x.group === "cash").map((x) => x.id);
    expect(resp).toEqual([w.c, w.a, w.b]);
    expect(await listIds(w.bid)).toEqual([w.c, w.a, w.b]);
    // persisted: a fresh request, and straight from D1
    expect(await listIds(w.bid)).toEqual([w.c, w.a, w.b]);
    const after = await sortsOf(w.bid);
    expect(after.get(w.credit)).toBe(before.get(w.credit));
    expect(after.get(w.loan)).toBe(before.get(w.loan));
    expect(Math.max(...after.values())).toBe(Math.max(...before.values()));
    expect(after.get(w.c)).toBe(before.get(w.a));
    expect(after.get(w.a)).toBe(before.get(w.b));
    expect(after.get(w.b)).toBe(before.get(w.c));
  });

  it("refuses a mix of groups with 422 account_groups_mixed and changes nothing", async () => {
    const w = await world();
    const before = await sortsOf(w.bid);
    const res = await put(w.bid, [w.a, w.credit]);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_groups_mixed");
    expect(await sortsOf(w.bid)).toEqual(before);
    expect(await logCount(w.bid)).toBe(0);
  });

  it("refuses a closed account with 422 account_closed", async () => {
    const w = await world();
    await send(`${A(w.bid)}/${w.b}/close`, "POST");
    const before = await sortsOf(w.bid);
    const res = await put(w.bid, [w.a, w.b]);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_closed");
    expect(await sortsOf(w.bid)).toEqual(before);
  });

  it("answers 404 for unknown, foreign and deleted ids and 422 for [] and duplicates", async () => {
    const w = await world();
    const other = await world();
    const gone = await account(w.bid, "checking");
    expect((await send(`${A(w.bid)}/${gone.id}`, "DELETE")).status).toBe(200);
    const before = await sortsOf(w.bid);
    for (const ids of [
      [w.a, "ZZ-nope"],
      [w.a, other.a],
      [w.a, gone.id],
    ]) {
      expect((await put(w.bid, ids)).status).toBe(404);
    }
    expect(
      (await send(`/api/v1/budgets/ZZ-nope/accounts/order`, "PUT", { account_ids: [w.a] })).status,
    ).toBe(404);
    for (const ids of [[], [w.a, w.a]]) {
      const res = await put(w.bid, ids);
      expect(res.status).toBe(422);
      expect(((await res.json()) as Json).error.name).toBe("unprocessable_entity");
    }
    expect(await sortsOf(w.bid)).toEqual(before);
  });

  it("the same order is a 200 with no change_log rows", async () => {
    const w = await world();
    expect((await put(w.bid, [w.a, w.b, w.c])).status).toBe(200);
    expect(await logCount(w.bid)).toBe(0);
  });

  it("logs one update row per changed account, in one change set", async () => {
    const w = await world();
    const before = await sortsOf(w.bid);
    const res = await put(w.bid, [w.c, w.a, w.b]);
    const set = res.headers.get("Budget-Change-Set");
    expect(set).toBeTruthy();
    const { results } = await env.DB.prepare(
      "select actor, action, entity_type, entity_id, before_json, after_json, change_set_id from change_log where budget_id = ? and entity_type = 'account' and action = 'update'",
    )
      .bind(w.bid)
      .all<Json>();
    expect(results).toHaveLength(3);
    const after = await sortsOf(w.bid);
    for (const r of results) {
      expect(r.actor).toBe(USER);
      expect(r.change_set_id).toBe(set);
      expect(JSON.parse(r.before_json).sort).toBe(before.get(r.entity_id));
      expect(JSON.parse(r.after_json).sort).toBe(after.get(r.entity_id));
    }
  });

  it("a subset (the starred accounts) reorders only those", async () => {
    const w = await world();
    const before = await sortsOf(w.bid);
    expect((await put(w.bid, [w.c, w.a])).status).toBe(200);
    expect(await listIds(w.bid)).toEqual([w.c, w.b, w.a]);
    expect((await sortsOf(w.bid)).get(w.b)).toBe(before.get(w.b));
  });

  it("a new account after a reorder is last in its section", async () => {
    const w = await world();
    await put(w.bid, [w.c, w.a, w.b]);
    const d = await account(w.bid, "checking");
    expect(await listIds(w.bid)).toEqual([w.c, w.a, w.b, d.id]);
  });

  it("ties: renumbers the plan in the new order, all sorts distinct", async () => {
    const w = await world();
    await env.DB.prepare(
      "update accounts set sort_order = (select sort_order from accounts where id = ?) where id = ?",
    )
      .bind(w.a, w.b)
      .run();
    expect((await put(w.bid, [w.c, w.b, w.a])).status).toBe(200);
    expect(await listIds(w.bid)).toEqual([w.c, w.b, w.a]);
    const sorts = [...(await sortsOf(w.bid)).values()];
    expect(new Set(sorts).size).toBe(sorts.length);
  });

  it("MCP reorder_accounts agrees with REST, as the mcp actor, with the same errors", async () => {
    const w = await world();
    const r = toolData(
      await callTool("reorder_accounts", { budget_id: w.bid, account_ids: [w.c, w.a, w.b] }),
    );
    expect((r.accounts as Json[]).filter((x) => x.group === "cash").map((x) => x.id)).toEqual([
      w.c,
      w.a,
      w.b,
    ]);
    expect(await listIds(w.bid)).toEqual([w.c, w.a, w.b]);
    const { results } = await env.DB.prepare(
      "select distinct actor from change_log where budget_id = ? and entity_type = 'account' and action = 'update'",
    )
      .bind(w.bid)
      .all<Json>();
    expect(results.map((x) => x.actor)).toEqual([MCP]);

    const rest = await put(w.bid, [w.a, w.credit]);
    const restText = ((await rest.json()) as Json).error.detail;
    const mixed = await callTool("reorder_accounts", {
      budget_id: w.bid,
      account_ids: [w.a, w.credit],
    });
    expect(mixed.isError).toBe(true);
    expect(mixed.content[0].text).toContain(restText);
    await send(`${A(w.bid)}/${w.b}/close`, "POST");
    const closedRest = ((await (await put(w.bid, [w.a, w.b])).json()) as Json).error.detail;
    const closed = await callTool("reorder_accounts", {
      budget_id: w.bid,
      account_ids: [w.a, w.b],
    });
    expect(closed.isError).toBe(true);
    expect(closed.content[0].text).toContain(closedRest);
    void json;
  });
});
