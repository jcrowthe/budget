import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  newPlan,
  oneAccountBank,
  posts,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

const OK = {
  success: {
    public_token: "public-test-token",
    institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
  },
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const row = (page: Page, name: string) =>
  sidebar(page).locator(".nav-account-row").filter({ hasText: name });
const mark = (page: Page, name: string) => row(page, name).locator(".nav-link-status");

/** ZZ Fine (connected, an hour ago) and ZZ Locked (login_required), both linked. */
async function twoAccounts(page: Page, request: Parameters<typeof newPlan>[0]) {
  const plan = await newPlan(request);
  const fine = await addAccount(request, plan, "ZZ Fine", "checking");
  const locked = await addAccount(request, plan, "ZZ Locked", "savings");
  const z = zzBank({ status: "connected", last_synced_at: hoursAgo(1) });
  const other = oneAccountBank("ZZ Other", "login_required", "4a5b6c");
  other.last_synced_at = hoursAgo(1);
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection, other],
    links: { [fine]: z.checking.id, [locked]: other.accounts[0]?.id as string },
  });
  return { plan, fine, locked, stub };
}

test("8 the mark's popup opens on hover: the last check, and Repair for a connection that needs a sign-in", async ({
  page,
  request,
}) => {
  await stubPlaidLink(page, OK);
  const { plan, fine, stub } = await twoAccounts(page, request);
  await page.goto(`/${plan}/accounts/${fine}`);
  await mark(page, "ZZ Fine").hover();
  const connected = page.getByRole("dialog", { name: "Connected", exact: true });
  await expect(connected).toContainText("Last checked an hour ago");
  await mark(page, "ZZ Locked").hover();
  const needs = page.getByRole("dialog", { name: "Connection Repair Needed", exact: true });
  await expect(needs).toBeVisible();
  await expect(connected).toHaveCount(0);
  const repair = needs.getByRole("button", { name: "Repair", exact: true });
  await expect(repair).toBeEnabled();
  await repair.hover();
  await expect(needs).toBeVisible();
  await realClick(page, repair);
  await expect
    .poll(() => posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBe(1);
  const reqs = stub.requests;
  const at = (tail: RegExp) =>
    reqs.findIndex((r) => r.method === "POST" && tail.test(new URL(r.url).pathname));
  expect(at(/\/link-token$/)).toBeGreaterThan(-1);
  expect(at(/\/link-token$/)).toBeLessThan(at(/\/reset$/));
  expect(at(/\/reset$/)).toBeLessThan(at(/\/sync$/));
  expect(posts(reqs, "POST", /\/reset$/)).toHaveLength(1);
});

test("9 the mark by the keyboard: Tab opens the popup, Tab reaches Repair, Escape closes it", async ({
  page,
  request,
}) => {
  const { plan, locked } = await twoAccounts(page, request);
  await page.goto(`/${plan}/accounts/${locked}`);
  const target = mark(page, "ZZ Locked");
  await expect(target).toBeVisible();
  await row(page, "ZZ Locked").getByRole("link").focus();
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  const dialog = page.getByRole("dialog", { name: "Connection Repair Needed", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Repair", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(target).toBeFocused();
});

test("10 a click on the row still opens the account, and the popup does not stay", async ({
  page,
  request,
}) => {
  const { plan, fine, locked } = await twoAccounts(page, request);
  await page.goto(`/${plan}/accounts/${fine}`);
  await mark(page, "ZZ Locked").hover();
  await expect(page.locator(".status-popup")).toBeVisible();
  await realClick(page, row(page, "ZZ Locked").locator(".name"));
  await expect(page).toHaveURL(new RegExp(`/accounts/${locked}$`));
  await expect(page.locator(".status-popup")).toHaveCount(0);
});
