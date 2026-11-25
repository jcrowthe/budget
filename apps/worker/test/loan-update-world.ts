import { env } from "cloudflare:test";
import { LoanActivityResponse } from "@budget/schema/loan-activity";
import { expect } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { D15, MORTGAGE, NOV, newPlan, openAccount, pay, send } from "./loan-world";

// EXF-543: the worked example W (docs/loan-update-balance-design.md): a 200,000.00 mortgage at 6%, escrow 300.00,
// a 1,500.00 payment on 2026-11-15, and (edited) an interest line of 1,050.00.
export const TODAY = D15;

export const updatePath = (bid: string, loan: string) =>
  `/api/v1/budgets/${bid}/accounts/${loan}/balance-update`;
export const update = (bid: string, loan: string, body: Json) =>
  send(updatePath(bid, loan), "POST", body);

/** The system payee of a kind in the plan, created directly when missing. */
export async function systemPayeeId(bid: string, system: string): Promise<string> {
  const found = (
    await q("select id from payees where budget_id = ? and system = ?", bid, system)
  )[0]?.id as string | undefined;
  if (found) return found;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into payees (id, budget_id, name, system, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, bid, system, system, now, now)
    .run();
  return id;
}

/** A stored interest or escrow row written directly, as Add Activity (EXF-542) will: not reconciled by default. */
export async function frozenRow(
  bid: string,
  loan: string,
  system: "loan_interest" | "loan_escrow",
  amount: number,
  opts: { cleared?: string; date?: string } = {},
): Promise<string> {
  const p = await systemPayeeId(bid, system);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `insert into transactions (id, budget_id, account_id, date, payee_id, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign)
     values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
  )
    .bind(id, bid, loan, opts.date ?? D15, p, amount, opts.cleared ?? "cleared", now, now)
    .run();
  return id;
}

export type Mortgage = { bid: string; checking: Json; loan: Json; paymentTx: string };

/** Plan, Checking, the mortgage and the 1,500.00 payment; `edited` adds the 1,050.00 edited interest row. */
export async function mortgageWorld(
  opts: { edited?: boolean; payments?: string[]; rate?: string } = {},
): Promise<Mortgage & { editedId: string | null }> {
  const bid = await newPlan();
  const checking = await openAccount(bid, {
    name: "Checking",
    type: "checking",
    balance: 50000000,
  });
  const loan = await openAccount(bid, {
    ...MORTGAGE,
    ...(opts.rate ? { interest_rate: opts.rate } : {}),
  });
  let paymentTx = "";
  for (const date of opts.payments ?? [D15]) {
    const res = await pay(bid, loan.id, { from_account_id: checking.id, amount: 1500000, date });
    expect(res.status).toBe(201);
    paymentTx ||= ((await res.json()) as Json).data.to_transaction.id;
  }
  const editedId = opts.edited ? await frozenRow(bid, loan.id, "loan_interest", -1050000) : null;
  return { bid, checking, loan, paymentTx, editedId };
}

export const activity = async (bid: string, loan: string, m = NOV) => {
  const res = await json(`/api/v1/budgets/${bid}/accounts/${loan}/activity?month=${m}`);
  expect(res.status).toBe(200);
  return LoanActivityResponse.parse(await res.json()).data;
};
export const accountOf = async (bid: string, id: string): Promise<Json> =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${id}`)).json()) as Json).data.account;
export const balanceOf = async (bid: string, id: string) => (await accountOf(bid, id)).balance;
export const rta = async (bid: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/months/${NOV}`)).json()) as Json).data
    .ready_to_assign as number;
export const rows = async (bid: string, table: string) =>
  (await q(`select count(*) n from ${table} where budget_id = ?`, bid))[0]?.n as number;
