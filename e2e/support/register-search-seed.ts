import type { APIRequestContext } from "@playwright/test";
import { authHeaders, testName } from "./auth";
import { call, TODAY } from "./register-seed";

/**
 * A ZZ-TEST plan for the register search (EXF-528): ZZ-TEST Checking and ZZ-TEST Savings, the categories
 * ZZ Fun and ZZ Groceries, and on Checking (all dated today):
 *  - ZZ Corner Store, -25.00, uncleared, unapproved;
 *  - ZZ Bakery, memo "corner table", -15.00;
 *  - ZZ Market, -30.00, cleared;
 *  - ZZ Split Payee, -30.00 split into ZZ Fun -10.00 (memo "gift") and ZZ Groceries -20.00;
 * and on Savings: ZZ Savings Payee, -2.00. API only.
 */
export async function seedSearch(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("search") });
  const plan = budget.id as string;
  const open = async (name: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type: "checking",
        balance: 1000000,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ-TEST Checking");
  const savings = await open("ZZ-TEST Savings");
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Search" })
  ).category_group.id as string;
  const cat = async (name: string) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/categories`, { group_id: group, name }))
      .category.id as string;
  const fun = await cat("ZZ Fun");
  const groceries = await cat("ZZ Groceries");
  const add = async (account_id: string, body: Record<string, unknown>) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id,
        date: TODAY,
        ...body,
      })
    ).transaction.id as string;
  const corner = await add(checking, {
    payee_name: "ZZ Corner Store",
    amount: -25000,
    category_id: groceries,
    approved: false,
  });
  const bakery = await add(checking, {
    payee_name: "ZZ Bakery",
    memo: "corner table",
    amount: -15000,
    category_id: groceries,
  });
  const market = await add(checking, {
    payee_name: "ZZ Market",
    amount: -30000,
    category_id: groceries,
    cleared: "cleared",
  });
  const split = await add(checking, {
    payee_name: "ZZ Split Payee",
    amount: -30000,
    subtransactions: [
      { amount: -10000, category_id: fun, memo: "gift" },
      { amount: -20000, category_id: groceries },
    ],
  });
  const sav = await add(savings, {
    payee_name: "ZZ Savings Payee",
    amount: -2000,
    category_id: groceries,
  });
  return { plan, checking, savings, ids: { corner, bakery, market, split, sav } };
}

/** The ids `GET …/transactions?q=` returns, through the API (the contract's REST side). */
export async function searchIds(
  request: APIRequestContext,
  plan: string,
  q: string,
  account?: string,
) {
  const path = `/api/v1/budgets/${plan}${account ? `/accounts/${account}` : ""}/transactions?q=${encodeURIComponent(q)}`;
  const res = await request.fetch(path, { headers: await authHeaders() });
  if (!res.ok()) throw new Error(`${path} -> ${res.status()}`);
  return ((await res.json()).data.transactions as { id: string }[]).map((t) => t.id).sort();
}
