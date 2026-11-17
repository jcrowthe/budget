import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders, testName } from "./auth";
import {
  type FakeConnection,
  fakeBankAccount,
  fakeConnection,
  stubBankLink,
} from "./bank-link-stub";
import { realClick } from "./real-click";

export async function newPlan(
  request: APIRequestContext,
  env: "sandbox" | "production" = "sandbox",
) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("mc"), bank_environment: env },
  });
  return (await res.json()).data.budget.id as string;
}
export async function addAccount(
  request: APIRequestContext,
  id: string,
  name: string,
  type: string,
  extra: { balance?: number } = {},
) {
  const res = await request.post(`/api/v1/budgets/${id}/accounts`, {
    headers: await authHeaders(),
    data: { name, type, balance: extra.balance ?? 0 },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.account.id as string;
}

/** ZZ Bank (connected, 0a1b2c): ZZ Checking – 0000 and ZZ Savings – 1111. */
export function zzBank(over: Partial<FakeConnection> = {}) {
  const checking = fakeBankAccount({ name: "ZZ Checking", mask: "0000" });
  const savings = fakeBankAccount({
    name: "ZZ Savings",
    mask: "1111",
    subtype: "savings",
    current_balance: 300000,
    plan_type: "savings",
  });
  const connection = fakeConnection({
    nickname: "ZZ Bank",
    display_id: "0a1b2c",
    accounts: [checking, savings],
    ...over,
  });
  return { checking, savings, connection };
}
export const oneAccountBank = (nickname: string, status: FakeConnection["status"], id: string) =>
  fakeConnection({
    nickname,
    status,
    display_id: id,
    accounts: [fakeBankAccount({ name: `${nickname} Account`, mask: "7777" })],
  });

export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
export const modal = (page: Page) => page.locator(".manage-connections");
export const dialogNamed = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true });

/** A sandbox plan with ZZ Linked (a checking account linked to ZZ Checking) and the given connections. */
export async function setup(
  page: Page,
  request: APIRequestContext,
  connections: (z: ReturnType<typeof zzBank>) => FakeConnection[],
  opts: Partial<Parameters<typeof stubBankLink>[2]> & {
    zz?: Partial<FakeConnection>;
    extra?: boolean;
  } = {},
) {
  const z = zzBank(opts.zz);
  const budgetId = await newPlan(request);
  const linkedId = await addAccount(request, budgetId, "ZZ Linked", "checking", {
    balance: 1250500,
  });
  const { zz: _zz, extra: _extra, ...rest } = opts;
  const stub = await stubBankLink(page, request, {
    budgetId,
    connections: connections(z),
    links: { [linkedId]: z.checking.id },
    ...rest,
  });
  await page.goto(`/${budgetId}/budget`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  return { z, budgetId, linkedId, stub };
}

export async function openList(page: Page) {
  await realClick(
    page,
    sidebar(page).getByRole("button", { name: "Bank Connections", exact: true }),
  );
  const dialog = dialogNamed(page, "Manage Bank Connections");
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function openDetail(page: Page, nickname: string) {
  const dialog = await openList(page);
  await realClick(page, dialog.getByRole("button", { name: nickname, exact: true }));
  await expect(dialogNamed(page, nickname)).toBeVisible();
  return dialogNamed(page, nickname);
}
export const posts = (reqs: { method: string; url: string }[], method: string, tail: RegExp) =>
  reqs.filter((r) => r.method === method && tail.test(new URL(r.url).pathname));
export const connectionGets = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "GET" && /\/bank-connections\/[^/?]+\?/.test(r.url));
export const listGets = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "GET" && /\/bank-connections\?/.test(r.url));

export async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}
