import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  newPlan,
  oneAccountBank,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const row = (page: Page, name: string) =>
  sidebar(page).locator(".nav-account-row").filter({ hasText: name });
const mark = (page: Page, name: string) => row(page, name).locator(".nav-link-status");

/** A stand-in plan of 30 accounts; ZZ Acct 01 is linked, with the given status. */
async function longList(
  page: Page,
  request: Parameters<typeof newPlan>[0],
  status: "connected" | "login_required" | "broken",
) {
  const plan = await newPlan(request);
  const ids: string[] = [];
  for (let i = 1; i <= 30; i++) {
    ids.push(await addAccount(request, plan, `ZZ Acct ${String(i).padStart(2, "0")}`, "checking"));
  }
  const z = zzBank({ status, last_synced_at: hoursAgo(1) });
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [ids[0] as string]: z.checking.id },
  });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/${plan}/accounts/${ids[0]}`);
  await expect(mark(page, "ZZ Acct 01")).toBeVisible();
  return { plan, ids };
}

async function wheelOverList(page: Page) {
  await page.mouse.move(120, 600);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.locator(".sidebar-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
}

test("1 a pinned popup closes on a wheel over the sidebar's list", async ({ page, request }) => {
  await longList(page, request, "connected");
  await realClick(page, mark(page, "ZZ Acct 01"));
  const dialog = page.getByRole("dialog", { name: "Connected", exact: true });
  await expect(dialog).toBeVisible();
  await wheelOverList(page);
  await expect(dialog).toHaveCount(0);
});

test("2 a pinned popup closes on a resize of the window", async ({ page, request }) => {
  await longList(page, request, "connected");
  await realClick(page, mark(page, "ZZ Acct 01"));
  const dialog = page.getByRole("dialog", { name: "Connected", exact: true });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(dialog).toHaveCount(0);
});

test("3 a running Repair keeps the popup through a wheel and a resize", async ({
  page,
  request,
}) => {
  await longList(page, request, "login_required");
  // Registered after the stand-in's own routes, so that it is asked first.
  const held: (() => void)[] = [];
  await page.route(/\/bank-connections\/[^/]+\/link-token/, async (route) => {
    await new Promise<void>((resolve) => held.push(resolve));
    await route.fallback();
  });
  await realClick(page, mark(page, "ZZ Acct 01"));
  const dialog = page.getByRole("dialog", { name: "Connection Repair Needed", exact: true });
  await expect(dialog).toBeVisible();
  const repair = dialog.getByRole("button", { name: "Repair", exact: true });
  await expect(repair).toBeEnabled();
  await realClick(page, repair);
  await expect.poll(() => held.length).toBe(1);
  await wheelOverList(page);
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(dialog).toBeVisible();
  for (const release of held) release();
});

test("4 a broken connection has one name: header, mark, popup and the connections list", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await addAccount(request, plan, "ZZ Lost", "checking");
  const lost = oneAccountBank("ZZ Gone", "broken", "9f8e7d");
  lost.last_synced_at = hoursAgo(1);
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [lost],
    links: { [id]: lost.accounts[0]?.id as string },
  });
  await page.goto(`/${plan}/accounts/${id}`);
  await expect(page.locator(".acct-link-status")).toHaveText("Connection Lost");
  await expect(mark(page, "ZZ Lost")).toHaveAttribute("aria-label", "Connection Lost");
  await realClick(page, mark(page, "ZZ Lost"));
  await expect(page.getByRole("dialog", { name: "Connection Lost", exact: true })).toBeVisible();
  await realClick(page, page.locator("main"));
  await realClick(
    page,
    sidebar(page).getByRole("button", { name: "Bank Connections", exact: true }),
  );
  const list = page.getByRole("dialog", { name: "Manage Bank Connections", exact: true });
  await expect(list).toBeVisible();
  await realClick(page, list.getByRole("button", { name: "ZZ Gone", exact: true }));
  const detail = page.getByRole("dialog", { name: "ZZ Gone", exact: true });
  await expect(detail.locator(".mc-subtitle")).toHaveText("Connection Lost");
  await expect(detail.getByRole("note")).toContainText("Connection Lost");
});
