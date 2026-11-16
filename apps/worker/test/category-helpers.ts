import { env } from "cloudflare:test";
import { MonthDetailResponse } from "@budget/schema/months";
import { expect } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
export type Json = any;

export const actor = "user:tester@localhost";

/** A fresh plan with the default groups (Bills, Needs, Wants). */
export async function plan(): Promise<string> {
  return (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
}

export const api = (bid: string, path: string) => `/api/v1/budgets/${bid}${path}`;
export const send = (method: string, url: string, body?: unknown) => json(url, { method }, body);

export async function month(bid: string, m: string) {
  const res = await json(api(bid, `/months/${m}`));
  expect(res.status).toBe(200);
  return MonthDetailResponse.parse(await res.json()).data;
}
export type Month = Awaited<ReturnType<typeof month>>;
export const group = (m: Month, name: string) => {
  const g = m.groups.find((x) => x.name === name);
  if (!g) throw new Error(`no group ${name}`);
  return g;
};
export const cat = (m: Month, name: string) => {
  const c = m.groups.flatMap((g) => g.categories).find((x) => x.name === name);
  if (!c) throw new Error(`no category ${name}`);
  return c;
};
export const cell = (m: Month, name: string) => {
  const c = cat(m, name);
  return [c.assigned, c.activity, c.available];
};

export async function mcp(name: string, args: Record<string, unknown>) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  const r = await mcpRpc("tools/call", { name, arguments: args }, 2);
  return r.body.result as { structuredContent?: Json; isError?: boolean; content?: Json[] };
}

export async function logs(bid: string, entityType?: string) {
  const { results } = await env.DB.prepare(
    "select actor, entity_type, entity_id, action, before_json, after_json from change_log where budget_id = ? order by created_at, rowid",
  )
    .bind(bid)
    .all<{
      actor: string;
      entity_type: string;
      entity_id: string;
      action: string;
      before_json: string | null;
      after_json: string | null;
    }>();
  return entityType ? results.filter((r) => r.entity_type === entityType) : results;
}

export async function ids(bid: string) {
  const m = await month(bid, "2026-11-01");
  return { groups: m.groups, byName: (n: string) => cat(m, n).id };
}
