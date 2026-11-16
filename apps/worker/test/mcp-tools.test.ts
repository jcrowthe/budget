import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";

const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;

async function mcp(name: string, args: Record<string, unknown>): Promise<Json> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result;
}
const errorText = (r: Json) => String(r.content?.[0]?.text ?? "");
const rest = async (path: string) => {
  const res = await json(`/api/v1${path}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
};
async function toolSchemas(): Promise<Record<string, Json>> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  const list = await mcpRpc("tools/list", {}, 2);
  return Object.fromEntries(((list.body.result?.tools ?? []) as Json[]).map((t) => [t.name, t]));
}
async function seed() {
  const bid = await plan();
  const res = await json(
    `/api/v1/budgets/${bid}/accounts`,
    { method: "POST" },
    { name: `ZZ ${crypto.randomUUID().slice(0, 8)}`, type: "checking", balance: 500000, date: DAY },
  );
  expect(res.status).toBe(201);
  const aid = ((await res.json()) as Json).data.account.id as string;
  const tres = await json(
    `/api/v1/budgets/${bid}/transactions`,
    { method: "POST" },
    { account_id: aid, date: DAY, amount: -12000, payee_name: "ZZ payee", memo: "ZZ memo" },
  );
  expect(tres.status).toBe(201);
  const tid = ((await tres.json()) as Json).data.transaction.id as string;
  return { bid, aid, tid };
}
const logRows = async (bid: string, action: string) =>
  (
    await env.DB.prepare(
      "select actor from change_log where entity_type = 'budget' and action = ? and entity_id = ?",
    )
      .bind(action, bid)
      .all<{ actor: string }>()
  ).results;

describe("mcp-tools", () => {
  it("lists the new tools", async () => {
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "get_budget",
        "update_budget",
        "delete_budget",
        "get_account",
        "get_account_summary",
        "get_transaction",
        "list_plan_months",
        "get_month_range",
      ]),
    );
  });

  it("answers like REST for the same input", async () => {
    const { bid, aid, tid } = await seed();
    const cases: [string, Record<string, unknown>, string][] = [
      ["get_budget", { budget_id: bid }, `/budgets/${bid}`],
      ["get_account", { budget_id: bid, account_id: aid }, `/budgets/${bid}/accounts/${aid}`],
      ["get_account_summary", { budget_id: bid }, `/budgets/${bid}/account-summary`],
      [
        "get_transaction",
        { budget_id: bid, transaction_id: tid },
        `/budgets/${bid}/transactions/${tid}`,
      ],
      [
        "list_plan_months",
        { budget_id: bid, from: "2026-09-01", to: "2026-11-01" },
        `/budgets/${bid}/months?from=2026-09-01&to=2026-11-01`,
      ],
      ["get_month_range", { budget_id: bid }, `/budgets/${bid}/month-range`],
      [
        "list_transactions",
        { budget_id: bid, account_id: aid },
        `/budgets/${bid}/accounts/${aid}/transactions`,
      ],
      ["list_transactions", { budget_id: bid }, `/budgets/${bid}/transactions`],
    ];
    for (const [tool, args, path] of cases) {
      const r = await mcp(tool, args);
      expect(r.isError, `${tool}: ${errorText(r)}`).toBeFalsy();
      expect(r.structuredContent, tool).toEqual(await rest(path));
    }
  });

  it("update_budget renames and switches environment, logged with an mcp actor", async () => {
    const bid = await plan();
    const name = `ZZ-TEST ${crypto.randomUUID()}`;
    const renamed = await mcp("update_budget", { budget_id: bid, name });
    expect(renamed.structuredContent).toEqual(await rest(`/budgets/${bid}`));
    expect(renamed.structuredContent.budget.name).toBe(name);
    const sandbox = await mcp("update_budget", { budget_id: bid, bank_environment: "sandbox" });
    expect(sandbox.structuredContent).toEqual(await rest(`/budgets/${bid}`));
    expect(sandbox.structuredContent.budget.bank_environment).toBe("sandbox");
    const rows = await logRows(bid, "update");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.actor === `mcp:${actor}`)).toBe(true);
    const props = Object.keys((await toolSchemas()).update_budget.inputSchema.properties).sort();
    expect(props).toEqual(["bank_environment", "budget_id", "name"]);
  });

  it("delete_budget deletes, logs an mcp actor, and answers tool errors for unknown plans", async () => {
    const bid = await plan();
    const r = await mcp("delete_budget", { budget_id: bid });
    expect(r.structuredContent).toEqual({ deleted: true });
    expect((await json(`/api/v1/budgets/${bid}`)).status).toBe(404);
    const rows = await logRows(bid, "delete");
    expect(rows.length).toBe(1);
    expect(rows[0]?.actor).toBe(`mcp:${actor}`);
    for (const id of [crypto.randomUUID(), "not-a-plan"]) {
      const e = await mcp("delete_budget", { budget_id: id });
      expect(e.isError).toBe(true);
      expect(errorText(e)).toMatch(/not found/i);
    }
  });

  it("get_transaction of another plan is a tool error", async () => {
    const a = await seed();
    const b = await plan();
    const e = await mcp("get_transaction", { budget_id: b, transaction_id: a.tid });
    expect(e.isError).toBe(true);
    expect(errorText(e)).toMatch(/not found/i);
  });

  it("list_plan_months with to before from is a tool error", async () => {
    const bid = await plan();
    const e = await mcp("list_plan_months", {
      budget_id: bid,
      from: "2026-11-01",
      to: "2026-09-01",
    });
    expect(e.isError).toBe(true);
  });

  it("set_month_note and list_bank_connections answer not found for a non-plan id", async () => {
    const note = await mcp("set_month_note", {
      budget_id: "not-a-plan",
      month: "2026-11-01",
      note: "x",
    });
    expect(note.isError).toBe(true);
    expect(errorText(note)).toMatch(/not found/i);
    const banks = await mcp("list_bank_connections", { budget_id: "not-a-plan" });
    expect(banks.isError).toBe(true);
    expect(errorText(banks)).toMatch(/not found/i);
  });

  it("cleared offers only uncleared and cleared", async () => {
    const schemas = await toolSchemas();
    for (const t of ["create_transaction", "update_transaction"]) {
      expect(schemas[t].inputSchema.properties.cleared.enum, t).toEqual(["uncleared", "cleared"]);
    }
    const { bid, aid } = await seed();
    const count = async () =>
      (
        await env.DB.prepare("select count(*) n from transactions where budget_id = ?")
          .bind(bid)
          .first<{ n: number }>()
      )?.n;
    const before = await count();
    const e = await mcp("create_transaction", {
      budget_id: bid,
      account_id: aid,
      date: DAY,
      amount: -1000,
      cleared: "reconciled",
    });
    expect(e.isError).toBe(true);
    expect(await count()).toBe(before);
  });

  it("descriptions carry their own facts", async () => {
    const schemas = await toolSchemas();
    expect(schemas.delete_transaction.description).toMatch(/cannot be deleted/);
    expect(schemas.delete_transaction.description).not.toMatch(/cannot be changed/);
    for (const w of ["Bills", "Needs", "Wants", "production", "sandbox"]) {
      expect(schemas.create_budget.description).toContain(w);
    }
  });
});
