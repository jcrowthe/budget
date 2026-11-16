import { env } from "cloudflare:test";
import { expect } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

export const USER = "user:tester@localhost";
export const DAY = "2026-11-10";
const MONTH = "2026-11-01";

export const plan = async () =>
  (await createBudget(env, USER, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
export const A = (bid: string) => `/api/v1/budgets/${bid}/accounts`;
export const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
export const data = async (res: Response) => ((await res.json()) as Json).data;
export async function account(bid: string, type = "checking", balance = 0, name?: string) {
  const res = await send(A(bid), "POST", {
    name: name ?? `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date: DAY,
  });
  expect(res.status).toBe(201);
  return (await data(res)).account as Json;
}
export const rta = async (bid: string) =>
  (await data(await json(`/api/v1/budgets/${bid}/months/${MONTH}`))).ready_to_assign as number;
export const txs = async (bid: string, aid: string) =>
  (await data(await json(`${A(bid)}/${aid}/transactions`))).transactions as Json[];
export const logs = async (aid: string) =>
  (
    await env.DB.prepare(
      "select actor, action, entity_type, before_json, after_json from change_log where entity_id = ? order by rowid",
    )
      .bind(aid)
      .all<Json>()
  ).results;
export async function tool(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}
