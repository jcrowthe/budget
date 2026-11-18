import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  dialogNamed,
  newPlan,
  openDetail,
  posts,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

const RELINK = "Relink your account to continue importing transactions.";
const RELINK_POPUP = "Your linked account is not found. Relink to continue importing transactions.";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const strip = (page: Page) => page.locator(".acct-connection-strip");
const mark = (page: Page, name: string) =>
  sidebar(page).locator(".nav-account-row").filter({ hasText: name }).locator(".nav-link-status");

/**
 * A stand-in sandbox plan: ZZ Linked linked to ZZ Checking of ZZ Bank (state 1 when `missing`), ZZ Savings
 * free in the same connection. The server's shape: `link_missing_since` as the Worker writes it.
 */
async function missingState(
  page: Page,
  request: APIRequestContext,
  over: Parameters<typeof zzBank>[0] = {},
  missing = true,
) {
  const z = zzBank({ status: "connected", last_synced_at: hoursAgo(1), ...over });
  const plan = await newPlan(request);
  const linked = await addAccount(request, plan, "ZZ Linked", "checking");
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [linked]: z.checking.id },
    missing: missing ? { [linked]: hoursAgo(2) } : {},
  });
  return { z, plan, linked, stub };
}

test("4 an account whose bank account was not found: the header, and the strip with Relink and Unlink", async ({
  page,
  request,
}) => {
  const s = await missingState(page, request);
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Account Not Found");
  await expect(strip(page).locator(".acct-connection-text")).toHaveText(RELINK);
  await expect(strip(page).getByRole("button", { name: "Relink", exact: true })).toBeEnabled();
  await expect(strip(page).getByRole("button", { name: "Unlink", exact: true })).toBeEnabled();
  // The sidebar's mark reads the same, and no connection was asked for.
  await expect(mark(page, "ZZ Linked")).toHaveAttribute("aria-label", "Account Not Found");
  expect(s.stub.requests.filter((r) => /\/bank-connections\/[^/?]+\?/.test(r.url))).toHaveLength(0);
});

test("4 Relink opens Link Account; choosing ZZ Savings sends one link and the strip goes", async ({
  page,
  request,
}) => {
  const s = await missingState(page, request);
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await realClick(page, strip(page).getByRole("button", { name: "Relink", exact: true }));
  const dialog = dialogNamed(page, "Link Account");
  await expect(dialog).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: /ZZ Savings/ }));
  await expect
    .poll(() => posts(s.stub.requests, "POST", /\/accounts\/[^/]+\/link$/).length)
    .toBe(1);
  expect(posts(s.stub.requests, "POST", /\/accounts\/[^/]+\/link$/)[0]?.body).toMatchObject({
    bank_account_id: s.z.savings.id,
  });
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator(".acct-link-status")).toHaveText("Connected");
});

test("4 Unlink opens the existing confirm", async ({ page, request }) => {
  const s = await missingState(page, request);
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await realClick(page, strip(page).getByRole("button", { name: "Unlink", exact: true }));
  const dialog = dialogNamed(page, "Unlink Account");
  await expect(dialog).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: "Unlink Account", exact: true }));
  await expect
    .poll(() => posts(s.stub.requests, "DELETE", /\/accounts\/[^/]+\/link$/).length)
    .toBe(1);
  await expect(strip(page)).toHaveCount(0);
});

test("5 the mark by the keyboard: Tab opens Account Not Found with Relink and Unlink, Escape closes it", async ({
  page,
  request,
}) => {
  const s = await missingState(page, request);
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  const target = mark(page, "ZZ Linked");
  await expect(target).toHaveAttribute("aria-label", "Account Not Found");
  await sidebar(page)
    .locator(".nav-account-row")
    .filter({ hasText: "ZZ Linked" })
    .getByRole("link")
    .focus();
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  const dialog = page.getByRole("dialog", { name: "Account Not Found", exact: true });
  await expect(dialog).toContainText(RELINK_POPUP);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Relink", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Unlink", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(target).toBeFocused();
});

test("6 which wins: a connection that needs a sign-in shows first; a delayed one gives way", async ({
  page,
  request,
}) => {
  const a = await missingState(page, request, { status: "login_required" });
  await page.goto(`/${a.plan}/accounts/${a.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Connection Repair Needed");
  await expect(strip(page).getByRole("button", { name: "Repair", exact: true })).toBeVisible();
  const b = await missingState(page, request, { status: "delayed" });
  await page.goto(`/${b.plan}/accounts/${b.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Account Not Found");
});

test("7 Manage Bank Connections: the bank account not found says so, the connected one does not", async ({
  page,
  request,
}) => {
  const z = zzBank({ status: "connected", last_synced_at: hoursAgo(1) });
  const plan = await newPlan(request);
  const lost = await addAccount(request, plan, "ZZ Linked", "checking");
  const found = await addAccount(request, plan, "ZZ Other", "savings");
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [lost]: z.checking.id, [found]: z.savings.id },
    missing: { [lost]: hoursAgo(2) },
  });
  await page.goto(`/${plan}/budget`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  const detail = await openDetail(page, "ZZ Bank");
  const rowOf = (label: string) => detail.getByRole("button", { name: label });
  await expect(rowOf("ZZ Checking – 0000")).toContainText("Account Not Found");
  await expect(rowOf("ZZ Savings – 1111")).not.toContainText("Account Not Found");
});
