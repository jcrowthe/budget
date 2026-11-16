import { env } from "cloudflare:test";
import { expect } from "vitest";
import { account, category, type Json, plan, q, send } from "./bulk-helpers";

export const TODAY = "2026-11-15";
export type { Json };
export { account, category, plan, q, send };

export const S = (bid: string) => `/api/v1/budgets/${bid}/scheduled-transactions`;

export async function body(res: Response): Promise<Json> {
  return ((await res.json()) as Json).data;
}

/** Creates a schedule through REST with `today` fixed; expects 201. */
export async function sched(bid: string, input: Json, today = TODAY): Promise<Json> {
  const res = await send(`${S(bid)}?today=${today}`, "POST", input);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return body(res);
}

export const enter = (bid: string, id: string, today = TODAY) =>
  send(`${S(bid)}/${id}/enter?today=${today}`, "POST");
export const enterDueRest = (bid: string, today = TODAY) =>
  send(`${S(bid)}/enter-due?today=${today}`, "POST");

export async function realRows(bid: string, accountId: string): Promise<Json[]> {
  return q(
    "select id, date, approved, cleared, amount, memo, payee_name, category_id from transactions where budget_id = ? and account_id = ? and deleted_at is null and payee_name is not 'Starting Balance' order by date, id",
    bid,
    accountId,
  );
}

export async function schedLogs(id: string): Promise<Json[]> {
  return q(
    "select actor, action, entity_type from change_log where entity_id = ? order by rowid",
    id,
  );
}

export async function setNext(id: string, dateNext: string, dateFirst = dateNext) {
  await env.DB.prepare(
    "update scheduled_transactions set date_next = ?, date_first = ? where id = ?",
  )
    .bind(dateNext, dateFirst, id)
    .run();
}
