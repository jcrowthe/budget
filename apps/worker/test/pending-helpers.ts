import { env } from "cloudflare:test";
import { expect } from "vitest";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  A,
  data,
  feed,
  hand,
  type Json,
  q,
  stubBank,
  syncOne,
  TX,
  world1,
} from "./plaid-sync-helpers";

/** A pending Plaid entry (Plaid's sign: positive leaves the account). */
export const pend = (id: string, over: Record<string, unknown> = {}) =>
  plaidTxn({
    transaction_id: id,
    pending: true,
    amount: 5,
    date: "2026-03-12",
    name: `ZZ Pend ${id}`,
    ...over,
  });

/** A posted entry that replaces the pending item `of`. */
export const posted = (id: string, of: string | null, over: Record<string, unknown> = {}) =>
  plaidTxn({
    transaction_id: id,
    pending_transaction_id: of,
    amount: 5,
    date: "2026-03-13",
    name: `ZZ Pend ${of ?? id}`,
    ...over,
  });

export const pendingRows = (account: string, live = true) =>
  q(
    `select * from pending_transactions where account_id = ? ${live ? "and deleted_at is null" : ""} order by plaid_transaction_id`,
    account,
  );

export const listPending = async (plan: string, account?: string) =>
  (await data(
    await json(`${TX(plan)}?status=pending${account ? `&account_id=${account}` : ""}`),
  )) as Json;

export const getAccount = async (plan: string, id: string) =>
  (await data(await json(`${A(plan)}/${id}`))).account as Json;

export const enterNow = (plan: string, id: string, body: Json = {}) =>
  json(`${TX(plan)}/${id}/enter-now`, { method: "POST" }, body);

/** A world with a stubbed bank, one linked checking account, and `pages` as the feed; one sync run. */
export async function pendingWorld(pages: Json[] = []) {
  const calls = stubBank();
  const w = await world1();
  const pages_: Json[] = [];
  const bank = async (page: Json) => {
    pages_.push(page);
    feed.pages = [...pages_] as typeof feed.pages;
    return syncOne(w.plan, w.conn);
  };
  for (const p of pages) await bank(p);
  const logs = (entity: string) =>
    q(
      "select * from change_log where entity_type = ? and budget_id = ? order by rowid",
      entity,
      w.plan,
    );
  return { ...w, bankIds: w.bank, calls, bank, logs };
}

export { env, expect, hand };
