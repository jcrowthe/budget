import { type MatchRow, matchRefusal, unmatchRefusal } from "@budget/schema/manual-match";
import { DEFAULT_FORMATTER } from "@budget/schema/plan-formats";
import { expect } from "vitest";
import { json } from "./helpers";
import { A, data, type Json, q, TX } from "./plaid-sync-helpers";

export const post = (path: string, body?: unknown) => json(path, { method: "POST" }, body);
export const MATCH = (plan: string) => `${TX(plan)}/match`;
export const UNMATCH = (plan: string, id: string) => `${TX(plan)}/${id}/unmatch`;

export const getTx = async (plan: string, id: string) =>
  (await data(await json(`${TX(plan)}/${id}`))).transaction as Json;
export const balanceOf = async (plan: string, account: string) =>
  (await data(await json(`${A(plan)}/${account}`))).account.balance as number;
export const live = (account: string) =>
  q(
    "select * from transactions where account_id = ? and deleted_at is null order by date, id",
    account,
  );

let seq = 0;
/** An unapproved import written by SQL (what the sync would have inserted), for states the feed cannot make. */
export async function sqlImport(plan: string, account: string, over: Json = {}) {
  const r = {
    id: `zz-imp-${++seq}-${crypto.randomUUID().slice(0, 8)}`,
    date: "2026-03-20",
    amount: -13000,
    cleared: "cleared",
    approved: 0,
    payee_name: "ZZ Bank Cafe",
    import_id: `ZZ-SQL-${seq}-${crypto.randomUUID().slice(0, 8)}`,
    ...over,
  };
  await q(
    `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at,
       payee_name, source, import_id, imported_payee, bank_description, import_date, import_amount, import_payee_name)
     values (?, ?, ?, ?, ?, ?, ?, '2026-03-20T00:00:00.000Z', '2026-03-20T00:00:00.000Z', ?, 'plaid', ?, ?, ?, ?, ?, ?)`,
    r.id,
    plan,
    account,
    r.date,
    r.amount,
    r.cleared,
    r.approved,
    r.payee_name,
    r.import_id,
    r.payee_name,
    r.payee_name,
    r.date,
    r.amount,
    r.payee_name,
  );
  return r;
}

/** Everything a refusal must leave alone. */
export const snapshot = async (plan: string) => ({
  tx: await q("select * from transactions where budget_id = ? order by id", plan),
  tombstones: await q(
    "select * from import_tombstones where budget_id = ? order by import_id",
    plan,
  ),
  log: (await q("select count(*) n from change_log"))[0]?.n,
});

const closedOf = async (plan: string, account: string) =>
  (await data(await json(`${A(plan)}/${account}`))).account.closed as boolean;

/** The pure rule of the register's bar must say what the server said, with the same words. */
export async function agrees(plan: string, ids: string[], res: Response) {
  const body = (await res.json()) as Json;
  const rows = await Promise.all(ids.map((id) => getTx(plan, id)));
  const accounts = new Map<string, boolean>();
  for (const r of rows) accounts.set(r.account_id, await closedOf(plan, r.account_id));
  const ctx = { closed: (id: string) => accounts.get(id) ?? false, fmt: DEFAULT_FORMATTER };
  const [a, b] = rows as unknown as MatchRow[];
  const refusal =
    ids.length === 2
      ? matchRefusal(a as MatchRow, b as MatchRow, ctx)
      : unmatchRefusal(a as MatchRow, ctx);
  expect(refusal).not.toBeNull();
  expect(body.error).toMatchObject({ name: refusal?.name, detail: refusal?.detail });
}
