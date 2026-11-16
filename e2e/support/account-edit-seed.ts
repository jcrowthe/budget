import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { authHeaders, testName } from "./auth";
import { realClick } from "./real-click";

export const DAY = "2026-11-10";

export async function api(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
) {
  const res = await request.fetch(path, { method, headers: await authHeaders(), data });
  return res;
}
export async function post(request: APIRequestContext, path: string, data?: unknown) {
  const res = await api(request, "POST", path, data);
  expect(res.ok(), path).toBe(true);
  return (await res.json()).data;
}
export const newPlan = async (request: APIRequestContext) =>
  (await post(request, "/api/v1/budgets", { name: testName("edit") })).budget.id as string;
export async function newAccount(
  request: APIRequestContext,
  plan: string,
  name: string,
  type = "checking",
  balance = 0,
) {
  return (
    await post(request, `/api/v1/budgets/${plan}/accounts`, { name, type, balance, date: DAY })
  ).account.id as string;
}
export async function getAccount(request: APIRequestContext, plan: string, id: string) {
  return (await (await api(request, "GET", `/api/v1/budgets/${plan}/accounts/${id}`)).json()).data
    .account;
}
export async function accountTxs(request: APIRequestContext, plan: string, id: string) {
  return (
    await (await api(request, "GET", `/api/v1/budgets/${plan}/accounts/${id}/transactions`)).json()
  ).data.transactions as {
    payee_name: string;
    amount: number;
    memo: string | null;
    inflow_to_ready_to_assign: boolean;
    category_id: string | null;
  }[];
}
export async function readyToAssign(request: APIRequestContext, plan: string) {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  return (await (await api(request, "GET", `/api/v1/budgets/${plan}/months/${month}`)).json()).data
    .ready_to_assign as number;
}

export const dialog = (page: Page, name = "Edit Account") =>
  page.getByRole("dialog", { name, exact: true });
export const dbutton = (page: Page, name: string) =>
  dialog(page).getByRole("button", { name, exact: true });
export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });

export async function openFromHeader(page: Page) {
  await realClick(
    page,
    page.getByRole("main").getByRole("button", { name: "Edit Account", exact: true }),
  );
  await expect(dialog(page)).toBeVisible();
}
export async function openFromSidebar(page: Page, accountName: string) {
  const row = sidebar(page).locator(".nav-account-row").filter({ hasText: accountName }).first();
  await row.hover();
  await realClick(page, row.getByRole("button", { name: "Edit Account", exact: true }));
  await expect(dialog(page)).toBeVisible();
}
/** Non-GET calls to the accounts API (the app also writes its own UI state) made from now on. */
export function writes(page: Page) {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/accounts"))
      seen.push(`${r.method()} ${r.url()}`);
  });
  return seen;
}
