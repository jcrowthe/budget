import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { authHeaders, testName } from "./auth";

// EXF-745: the plan behind the Activity amount specs. API only; specs fix the clock at 2026-11-16T12:00:00.
export const AMOUNT_MONTH = "2026-11-01";

export type AmountSeed = { id: string; categoryId: string; account: string };

async function call(
  request: APIRequestContext,
  method: "post" | "delete",
  path: string,
  data?: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json().catch(() => ({}))).data;
}

/** A plan with ZZ Checking, ZZ Group, ZZ Wide and three approved rows of 8, 10 and 12 wide characters. */
export async function seedAmounts(request: APIRequestContext): Promise<AmountSeed> {
  const { budget } = await call(request, "post", "/api/v1/budgets", {
    name: testName("activity-amount"),
  });
  const base = `/api/v1/budgets/${budget.id}`;
  const account = (
    await call(request, "post", `${base}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 0,
      date: "2026-11-02",
    })
  ).account.id as string;
  const group = (await call(request, "post", `${base}/category_groups`, { name: "ZZ Group" }))
    .category_group.id as string;
  const categoryId = (
    await call(request, "post", `${base}/categories`, { group_id: group, name: "ZZ Wide" })
  ).category.id as string;
  const s = { id: budget.id as string, categoryId, account };
  for (const [i, amount] of [-888_880, 88_888_880, -888_888_880].entries()) {
    await add(request, s, amount, `2026-11-${10 + i}`);
  }
  return s;
}

async function add(request: APIRequestContext, s: AmountSeed, amount: number, date: string) {
  await call(request, "post", `/api/v1/budgets/${s.id}/transactions`, {
    approved: true,
    account_id: s.account,
    date,
    amount,
    category_id: s.categoryId,
    payee_name: "ZZ Payee",
  });
}

/** Adds one approved transaction of `amount` milliunits to ZZ Wide on 2026-11-13. */
export const addAmount = (request: APIRequestContext, s: AmountSeed, amount: number) =>
  add(request, s, amount, "2026-11-13");

export const removeAmountPlan = (request: APIRequestContext, s: { id: string }) =>
  call(request, "delete", `/api/v1/budgets/${s.id}`);
