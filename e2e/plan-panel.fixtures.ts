import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { authHeaders, testName } from "./support/auth";
import { monthIso } from "./support/plan-seed";

export const RENT = "🏠 Rent/Mortgage";
export const PHONE = "📱 Phone & Internet";
export const UTILITIES = "⚡️ Utilities";
export const GROCERIES = "🛒 Groceries";
export const TRANSPORT = "🚘 Transportation";

export const TODAY = monthIso(0);
export const NEXT = monthIso(1);
export const longMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export type Seed = {
  id: string;
  name: string;
  account: string;
  cat: Record<string, string>;
};

async function call(
  request: APIRequestContext,
  method: "post" | "patch" | "delete",
  path: string,
  data?: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}`).toBe(true);
  return (await res.json().catch(() => ({}))).data;
}

/** A plan of its own with the default categories and an account holding `balance` milliunits. */
export async function seedPlan(
  request: APIRequestContext,
  label: string,
  balance = 500000,
): Promise<Seed> {
  const name = testName(label);
  const { budget } = await call(request, "post", "/api/v1/budgets", { name });
  const { account } = await call(request, "post", `/api/v1/budgets/${budget.id}/accounts`, {
    name: "ZZ Chk",
    type: "checking",
    balance,
    date: `${TODAY.slice(0, 8)}01`,
  });
  const month = await getMonth(request, budget.id, TODAY);
  const cat: Record<string, string> = {};
  for (const g of month.groups) for (const c of g.categories) cat[c.name] = c.id;
  return { id: budget.id, name, account: account.id, cat };
}

// biome-ignore lint/suspicious/noExplicitAny: the month read, as parsed JSON
export async function getMonth(
  request: APIRequestContext,
  plan: string,
  month: string,
): Promise<any> {
  const res = await request.get(`/api/v1/budgets/${plan}/months/${month}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data;
}

export const assign = (
  request: APIRequestContext,
  s: Seed,
  category: string,
  milli: number,
  month = TODAY,
) =>
  call(request, "patch", `/api/v1/budgets/${s.id}/months/${month}/categories/${s.cat[category]}`, {
    assigned: milli,
  });

export const spend = (request: APIRequestContext, s: Seed, category: string, milli: number) =>
  call(request, "post", `/api/v1/budgets/${s.id}/transactions`, {
    account_id: s.account,
    date: TODAY.replace(/01$/, "02"),
    amount: -milli,
    category_id: s.cat[category],
    payee_name: "ZZ Payee",
  });

export const removePlan = (request: APIRequestContext, s: Seed) =>
  call(request, "delete", `/api/v1/budgets/${s.id}`);

export async function openPlan(page: Page, s: Seed, month?: string) {
  await page.goto(`/${s.id}/budget${month ? `/${month.slice(0, 7).replace("-", "")}` : ""}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row").first()).toBeVisible();
}

export const row = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
export const box = (page: Page, name: string) => page.getByRole("checkbox", { name, exact: true });
export const panel = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
