import { env } from "cloudflare:test";
import { expect } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
export type Json = any;
export const DAY = "2026-11-10";
export const MONTH = "2026-11-01";
export const actor = "user:tester@localhost";

export const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);

export async function plan() {
  return (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
}

export async function account(bid: string, type = "checking", balance = 500000) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date: DAY,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}

export async function category(bid: string, suffix = "Groceries") {
  const m = (await (await json(`/api/v1/budgets/${bid}/months/${MONTH}`)).json()) as Json;
  return m.data.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.name.endsWith(suffix))
    .id as string;
}

export async function tx(bid: string, body: Json): Promise<Json> {
  const res = await send(`/api/v1/budgets/${bid}/transactions`, "POST", body);
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.transaction;
}

export const get = async (bid: string, id: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/transactions/${id}`)).json()) as Json).data
    .transaction as Json;

export const bulk = (bid: string, body: Json) =>
  send(`/api/v1/budgets/${bid}/transactions/bulk`, "POST", body);

export const bulkOk = async (bid: string, body: Json) => {
  const res = await bulk(bid, body);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
};

export const q = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;
export const logs = async (bid: string) =>
  (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n as number;

export const setSql = (id: string, set: string) =>
  env.DB.prepare(`update transactions set ${set} where id = ?`).bind(id).run();

export async function tool(name: string, args: unknown): Promise<Json> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body;
}
