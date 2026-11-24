import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  dialogNamed,
  newPlan,
  oneAccountBank,
  openDetail,
  openList,
  posts,
  setup,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
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
  await expect(page.locator(".acct-link-status")).toHaveText("Linked Account Not Found");
  await expect(strip(page).locator(".acct-connection-text")).toHaveText(RELINK);
  await expect(strip(page).getByRole("button", { name: "Relink", exact: true })).toBeEnabled();
  await expect(strip(page).getByRole("button", { name: "Unlink", exact: true })).toBeEnabled();
  // The sidebar's mark reads the same, and no connection was asked for.
  await expect(mark(page, "ZZ Linked")).toHaveAttribute("aria-label", "Linked Account Not Found");
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
  await expect(target).toHaveAttribute("aria-label", "Linked Account Not Found");
  await sidebar(page)
    .locator(".nav-account-row")
    .filter({ hasText: "ZZ Linked" })
    .getByRole("link")
    .focus();
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  const dialog = page.getByRole("dialog", { name: "Linked Account Not Found", exact: true });
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
  await expect(page.locator(".acct-link-status")).toHaveText("Linked Account Not Found");
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
  await expect(rowOf("ZZ Checking – 0000")).toContainText("Linked Account Not Found");
  await expect(rowOf("ZZ Savings – 1111")).not.toContainText("Account Not Found");
});

test("C2 the Bank Connections list: a broken connection's badge reads Connection Lost", async ({
  page,
  request,
}) => {
  await setup(page, request, (z) => [
    z.connection,
    oneAccountBank("ZZ Gone", "broken", "7a8b9c"),
    oneAccountBank("ZZ Locked", "login_required", "4a5b6c"),
  ]);
  const dialog = await openList(page);
  const row = (name: string) => dialog.getByRole("button", { name, exact: true });
  const gone = row("ZZ Gone").locator(".mc-badge");
  await expect(gone).toHaveText("Connection Lost");
  await expect(gone.locator("svg")).toHaveCount(1);
  await expect(row("ZZ Locked").locator(".mc-badge")).toHaveText("Repair");
  await expect(row("ZZ Bank").locator(".mc-badge")).toHaveCount(0);
  await expect(dialog.locator(".account-modal-body h3")).toHaveText([
    "Needs Attention",
    "All Others",
  ]);
  await realClick(page, row("ZZ Gone"));
  const detail = dialogNamed(page, "ZZ Gone");
  await expect(detail.locator(".mc-banner strong")).toHaveText("Connection Lost");
  await expect(detail.getByRole("button", { name: "Repair" })).toHaveCount(0);
});

const OK = {
  success: {
    public_token: "public-test-token",
    institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
  },
};

test("11 unavailable: its name, the 3-day line, no button", async ({ page, request }) => {
  const s = await missingState(
    page,
    request,
    { status: "delayed", reason: "unavailable", last_synced_at: hoursAgo(96) },
    false,
  );
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText(
    "Direct Import is Temporarily Unavailable",
  );
  await expect(strip(page).locator(".acct-connection-text")).toHaveText(
    "Imports have been delayed for over 3 days. Try Reset in Bank Connections.",
  );
  await expect(strip(page).getByRole("button")).toHaveCount(0);
  await expect(mark(page, "ZZ Linked")).toHaveAttribute(
    "aria-label",
    "Direct Import is Temporarily Unavailable",
  );
});

test("11 unsupported: its name, and no strip", async ({ page, request }) => {
  const s = await missingState(
    page,
    request,
    { status: "delayed", reason: "unsupported", last_synced_at: hoursAgo(96) },
    false,
  );
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Connection Unavailable");
  await expect(strip(page)).toHaveCount(0);
  await mark(page, "ZZ Linked").focus();
  await expect(
    page.getByRole("dialog", { name: "Connection Unavailable", exact: true }),
  ).toContainText("no longer supports this bank");
});

test("11 reauthorize: its name and sentence; Reauthorize posts link-token, reset and sync in that order", async ({
  page,
  request,
}) => {
  await stubPlaidLink(page, OK);
  const s = await missingState(
    page,
    request,
    { status: "login_required", reason: "reauthorize" },
    false,
  );
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Reauthorization Needed");
  await expect(strip(page).locator(".acct-connection-text")).toHaveText(
    "Reauthorize your bank connection to continue importing transactions.",
  );
  await expect(strip(page).getByRole("button", { name: "Repair", exact: true })).toHaveCount(0);
  await realClick(page, strip(page).getByRole("button", { name: "Reauthorize", exact: true }));
  await expect
    .poll(() => posts(s.stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBe(1);
  const at = (tail: RegExp) =>
    s.stub.requests.findIndex((r) => r.method === "POST" && tail.test(new URL(r.url).pathname));
  expect(at(/\/link-token$/)).toBeGreaterThan(-1);
  expect(at(/\/link-token$/)).toBeLessThan(at(/\/reset$/));
  expect(at(/\/reset$/)).toBeLessThan(at(/\/sync$/));
  await expect(strip(page)).toHaveCount(0);
});

test("11 the connection's own pages use the reason's words", async ({ page, request }) => {
  const plan = await newPlan(request);
  const linked = await addAccount(request, plan, "ZZ Linked", "checking");
  const z = zzBank({
    status: "login_required",
    reason: "reauthorize",
    last_synced_at: hoursAgo(1),
  });
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [linked]: z.checking.id },
  });
  await page.goto(`/${plan}/budget`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  const detail = await openDetail(page, "ZZ Bank");
  await expect(detail.locator(".mc-subtitle")).toHaveText("Reauthorization Needed");
  await expect(detail.getByRole("note")).toContainText(
    "Reauthorize your bank connection to continue importing transactions.",
  );
  await expect(detail.getByRole("button", { name: "Reauthorize", exact: true })).toBeVisible();
});
