import { env } from "cloudflare:test";
import { data, send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";

export const RR = (bid: string, payeeId: string) => `${P(bid)}/${payeeId}/rename-rules`;

/** A plan with the payees by name made through hand transactions. */
export async function rulesWorld(names: string[]) {
  const w = await payeeWorld();
  for (const n of names) await w.tx(n);
  return w;
}

export async function addRule(
  bid: string,
  payeeId: string,
  kind: "is" | "contains",
  text: string,
): Promise<Json> {
  const res = await send(RR(bid, payeeId), "POST", { kind, text });
  if (res.status !== 201) throw new Error(`rule refused: ${res.status} ${await res.text()}`);
  return (await data(res)).rule as Json;
}

export const liveRules = async (bid: string): Promise<Json[]> =>
  (
    await env.DB.prepare(
      "select id, payee_id, kind, text, match_text, created_at from payee_rename_rules where budget_id = ? and deleted_at is null order by created_at, id",
    )
      .bind(bid)
      .all<Json>()
  ).results;

export const ruleLogs = async (bid: string): Promise<Json[]> =>
  (
    await env.DB.prepare(
      "select actor, action, entity_id, before_json, after_json from change_log where budget_id = ? and entity_type = 'payee_rename_rule' order by rowid",
    )
      .bind(bid)
      .all<Json>()
  ).results;
