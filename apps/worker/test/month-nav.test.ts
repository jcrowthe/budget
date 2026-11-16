import { env } from "cloudflare:test";
import { toMonth } from "@budget/core/month";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned, setMonthNote } from "../src/services/months";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import { apiDocument, apiPaths, listedToolNames, mcpRpc } from "./surface";

const actor = "user:tester@localhost";
const OCT = "2026-10-01";
const NOV = "2026-11-01";

type Json = Record<string, any>;

async function seed() {
  const budget = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const bid = budget.id;
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  const group = await createCategoryGroup(env, actor, { budget_id: bid, name: "Bills" });
  const cat = await createCategory(env, actor, {
    budget_id: bid,
    group_id: group.id,
    name: "Rent",
  });
  const assign = (month: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month, category_id: cat.id, assigned });
  const tx = (date: string) =>
    createTransaction(env, actor, {
      budget_id: bid,
      account_id: account.id,
      date,
      amount: -1000,
      category_id: cat.id,
      inflow_to_ready_to_assign: false,
    });
  return { bid, assign, tx };
}

const patch = (bid: string, month: string, body: unknown, headers: Record<string, string> = {}) =>
  json(`/api/v1/budgets/${bid}/months/${month}`, { method: "PATCH", headers }, body);
const getMonth = async (bid: string, month: string) =>
  (await (await json(`/api/v1/budgets/${bid}/months/${month}`)).json()) as Json;
const range = async (bid: string) => {
  const res = await json(`/api/v1/budgets/${bid}/month-range`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
};
const logRows = async (bid: string) =>
  (
    await env.DB.prepare(
      "select entity_type, entity_id, action, actor, before_json, after_json from change_log where budget_id = ? and entity_type = 'month' order by created_at",
    )
      .bind(bid)
      .all<Json>()
  ).results;

async function initMcp() {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
}

describe("surface", () => {
  it("lists the new paths and tool", async () => {
    const paths = await apiPaths();
    expect(paths).toContain("/api/v1/budgets/{budget_id}/month-range");
    expect(paths).toContain("/api/v1/budgets/{budget_id}/months/{month}");
    const doc = await apiDocument();
    expect(
      Object.keys(doc.paths["/api/v1/budgets/{budget_id}/months/{month}"] as object),
    ).toContain("patch");
    expect(await listedToolNames()).toContain("set_month_note");
  });
});

describe("PATCH month note", () => {
  it("trims, logs one row, reads back, clears", async () => {
    const { bid } = await seed();
    const res = await patch(bid, OCT, { note: "  hi  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { month: OCT, note: "hi" } });
    const rows = await logRows(bid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity_type: "month",
      entity_id: OCT,
      action: "update",
      actor,
    });
    expect(JSON.parse(rows[0]?.before_json)).toEqual({ month: OCT, note: null });
    expect(JSON.parse(rows[0]?.after_json)).toEqual({ month: OCT, note: "hi" });
    expect((await getMonth(bid, OCT)).data.note).toBe("hi");
    expect(((await (await patch(bid, OCT, { note: "   " })).json()) as Json).data.note).toBeNull();
    expect((await getMonth(bid, OCT)).data.note).toBeNull();
    expect(((await (await patch(bid, OCT, { note: null })).json()) as Json).data.note).toBeNull();
  });

  it("keeps months independent", async () => {
    const { bid } = await seed();
    await patch(bid, OCT, { note: "a" });
    await patch(bid, NOV, { note: "b" });
    expect((await getMonth(bid, OCT)).data.note).toBe("a");
    expect((await getMonth(bid, NOV)).data.note).toBe("b");
  });

  it("validates", async () => {
    const { bid } = await seed();
    expect((await patch(bid, OCT, { note: "x".repeat(5001) })).status).toBe(422);
    expect((await patch(bid, OCT, { note: "x".repeat(5000) })).status).toBe(200);
    expect((await patch(bid, "2026-10-02", { note: "x" })).status).toBe(422);
    expect((await patch(bid, "2300-01-01", { note: "x" })).status).toBe(422);
    expect((await patch(bid, OCT, {})).status).toBe(422);
    expect((await patch(crypto.randomUUID(), OCT, { note: "x" })).status).toBe(404);
  });

  it("replays an Idempotency-Key into one history row", async () => {
    const { bid } = await seed();
    const h = { "Idempotency-Key": crypto.randomUUID() };
    expect((await patch(bid, OCT, { note: "k" }, h)).status).toBe(200);
    expect((await patch(bid, OCT, { note: "k" }, h)).status).toBe(200);
    expect(await logRows(bid)).toHaveLength(1);
  });
});

describe("MCP set_month_note", () => {
  it("writes the same row shape with an mcp actor", async () => {
    const { bid } = await seed();
    await patch(bid, OCT, { note: "x" });
    await initMcp();
    const res = await mcpRpc(
      "tools/call",
      { name: "set_month_note", arguments: { budget_id: bid, month: NOV, note: "x" } },
      5,
    );
    expect(res.body.result?.structuredContent).toEqual({ month: NOV, note: "x" });
    const rows = await logRows(bid);
    expect(rows).toHaveLength(2);
    const [rest, mcp] = rows;
    expect(mcp?.actor.startsWith("mcp:")).toBe(true);
    expect(mcp).toMatchObject({ entity_type: "month", entity_id: NOV, action: "update" });
    expect(JSON.parse(mcp?.before_json)).toEqual({ month: NOV, note: null });
    expect(Object.keys(JSON.parse(mcp?.after_json))).toEqual(
      Object.keys(JSON.parse(rest?.after_json)),
    );
  });
});

describe("GET month-range", () => {
  it("is the creation month on a new plan", async () => {
    const { bid } = await seed();
    const created = (
      await env.DB.prepare("select created_at from budgets where id = ?").bind(bid).first<Json>()
    )?.created_at;
    expect(await range(bid)).toEqual({ first_month: toMonth(created), last_assigned_month: null });
  });

  it("follows notes, assignments and transactions", async () => {
    const { bid, assign, tx } = await seed();
    const base = (await range(bid)).first_month as string;
    await setMonthNote(env, actor, { budget_id: bid, month: "2020-03-01", note: "n" });
    expect((await range(bid)).first_month).toBe("2020-03-01");
    await setMonthNote(env, actor, { budget_id: bid, month: "2020-03-01", note: " " });
    expect((await range(bid)).first_month).toBe(base);

    await assign("2020-05-01", 0);
    expect((await range(bid)).first_month).toBe(base);
    await assign("2020-05-01", 1000);
    expect(await range(bid)).toEqual({
      first_month: "2020-05-01",
      last_assigned_month: "2020-05-01",
    });

    const t = await tx("2019-12-15");
    expect((await range(bid)).first_month).toBe("2019-12-01");
    await env.DB.prepare("update transactions set deleted_at = ? where id = ?")
      .bind(new Date().toISOString(), t.id)
      .run();
    expect((await range(bid)).first_month).toBe("2020-05-01");

    await assign("2030-01-01", 5);
    await assign("2029-01-01", 5);
    expect((await range(bid)).last_assigned_month).toBe("2030-01-01");
  });

  it("404s for an unknown plan", async () => {
    const res = await json(`/api/v1/budgets/${crypto.randomUUID()}/month-range`);
    expect(res.status).toBe(404);
  });
});
