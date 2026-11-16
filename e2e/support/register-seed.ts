import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders, testName } from "./auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const MONTH = `${TODAY.slice(0, 7)}-01`;

export async function call(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
) {
  // A busy server (other specs share its D1) may answer 409 or 5xx once: seeding retries those.
  let res = await request.fetch(path, { method, headers: await authHeaders(), data });
  for (
    let attempt = 0;
    attempt < 4 && !res.ok() && (res.status() === 409 || res.status() >= 500);
    attempt++
  ) {
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    res = await request.fetch(path, { method, headers: await authHeaders(), data });
  }
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()).data;
}

/** A plan with ZZ Checking ($2,500.00), ZZ Card ($1,500.00 owed), ZZ Asset (tracking) and D4 Groceries ($200.00). */
export async function seed(request: APIRequestContext, withCategory = true) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("entry") });
  const plan = budget.id as string;
  const open = (name: string, type: string, balance: number) =>
    call(request, "POST", `/api/v1/budgets/${plan}/accounts`, { name, type, balance, date: TODAY });
  const checking = (await open("ZZ Checking", "checking", 2500000)).account.id as string;
  const card = (await open("ZZ Card", "creditCard", 1500000)).account.id as string;
  const asset = (await open("ZZ Asset", "otherAsset", 5000000)).account.id as string;
  let category = "";
  if (withCategory) {
    const g = (
      await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
        name: "D4 Register",
      })
    ).category_group.id;
    category = (
      await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
        group_id: g,
        name: "D4 Groceries",
      })
    ).category.id as string;
    await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${MONTH}/categories/${category}`, {
      assigned: 200000,
    });
  }
  return { plan, checking, card, asset, category };
}

export const txs = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as {
    id: string;
    payee_name: string | null;
    payee_id: string | null;
    amount: number;
    cleared: string;
    approved: boolean;
    category_id: string | null;
    date: string;
    memo: string | null;
  }[];

export const payeeList = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/payees?include_hidden=true`)).payees as {
    id: string;
    name: string;
    hidden: boolean;
    system: string | null;
    last_category_id: string | null;
  }[];
