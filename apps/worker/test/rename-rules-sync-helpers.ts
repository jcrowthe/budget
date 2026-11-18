import { expect } from "vitest";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  data,
  feed,
  hand,
  imports,
  type Json,
  q,
  stubBank,
  syncOne,
  world1,
} from "./plaid-sync-helpers";

export const PAYEES = (plan: string) => `/api/v1/budgets/${plan}/payees`;

/** A world with one linked account; `payee(name, rules)` makes the payee (a hand row) and its rules. */
export async function setup() {
  stubBank();
  const w = await world1();
  const pages: Json[] = [];
  const payee = async (name: string, rules: ["is" | "contains", string][] = []) => {
    const res = await hand(w.plan, {
      account_id: w.account,
      date: "2026-03-01",
      amount: -1000,
      payee_name: name,
    });
    expect(res.status).toBe(201);
    const list = (await data(await json(`${PAYEES(w.plan)}?include_hidden=true`))).payees as Json[];
    const id = list.find((p) => p.name === name)?.id as string;
    for (const [kind, text] of rules) {
      const r = await json(
        `${PAYEES(w.plan)}/${id}/rename-rules`,
        { method: "POST" },
        { kind, text },
      );
      expect(r.status).toBe(201);
      // rules are told apart by their creation time
      await new Promise((ok) => setTimeout(ok, 3));
    }
    return id;
  };
  /** One more feed page, synced. */
  const bank = async (page: Json) => {
    pages.push(page);
    feed.pages = [...pages] as typeof feed.pages;
    return syncOne(w.plan, w.conn);
  };
  const payeeNames = async () =>
    (await q("select name from payees where budget_id = ? and deleted_at is null", w.plan)).map(
      (p) => p.name as string,
    );
  const row = async (importId: string) =>
    (await imports(w.account)).find((x) => x.import_id === importId) as Json;
  return { ...w, payee, bank, payeeNames, row };
}

export const txn = (id: string, merchant: string, over: Json = {}) =>
  plaidTxn({ transaction_id: id, merchant_name: merchant, name: `ZZ Shop ${id}`, ...over });
