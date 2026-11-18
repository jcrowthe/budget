import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  box,
  newPlan,
  oneAccountBank,
  setup,
  sidebar,
  type zzBank,
} from "./support/manage-connections-seed";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test.use({ viewport: { width: 1024, height: 700 } });

async function openStates(
  page: Page,
  request: Parameters<typeof newPlan>[0],
  zz: Parameters<typeof zzBank>[0],
) {
  const s = await setup(page, request, (z) => [z.connection], { zz });
  await page.goto(`/${s.budgetId}/accounts/${s.linkedId}`);
  await expect(page.locator(".acct-connection-strip")).toBeVisible();
  return s;
}

async function stripFits(page: Page) {
  const button = page.locator(".acct-connection-strip button");
  const main = await box(page.locator("main").first());
  if ((await button.count()) > 0) {
    await expect(button).toBeInViewport({ ratio: 1 });
    const b = await box(button);
    expect(b.x).toBeGreaterThanOrEqual(main.x);
    expect(b.x + b.width).toBeLessThanOrEqual(main.x + main.width);
  }
  const fits = await page
    .locator(".acct-connection-text")
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
}

test("1 the strip with Repair fits at 1024x700", async ({ page, request }) => {
  await openStates(page, request, { status: "login_required", last_synced_at: hoursAgo(1) });
  await stripFits(page);
});

test("3 the delay line fits at 1024x700", async ({ page, request }) => {
  await openStates(page, request, { status: "delayed", last_synced_at: hoursAgo(96) });
  await stripFits(page);
});

test("4 the broken strip and its button fit at 1024x700", async ({ page, request }) => {
  await openStates(page, request, { status: "broken", last_synced_at: hoursAgo(1) });
  await stripFits(page);
});

test("5 the popup lies inside the window", async ({ page, request }) => {
  await openStates(page, request, { status: "login_required", last_synced_at: hoursAgo(1) });
  await sidebar(page).locator(".nav-link-status").first().hover();
  const popup = page.locator(".status-popup");
  await expect(popup).toBeVisible();
  await expect.poll(async () => (await box(popup)).x).toBeGreaterThanOrEqual(0);
  const b = await box(popup);
  expect(b.x + b.width).toBeLessThanOrEqual(1024);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(700);
});

test.describe("narrow sidebar and rail", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sidebar-preferred-width", "160"));
  });

  async function twoRows(page: Page, request: Parameters<typeof newPlan>[0]) {
    const plan = await newPlan(request);
    const locked = await addAccount(request, plan, "ZZ Locked", "checking");
    const other = oneAccountBank("ZZ Other", "login_required", "4a5b6c");
    other.last_synced_at = hoursAgo(1);
    await stubBankLink(page, request, {
      budgetId: plan,
      connections: [other],
      links: { [locked]: other.accounts[0]?.id as string },
    });
    await page.goto(`/${plan}/accounts/${locked}`);
    return plan;
  }

  test("6 at a narrow width the mark stays inside its row and the popup inside the window", async ({
    page,
    request,
  }) => {
    await twoRows(page, request);
    const row = sidebar(page).locator(".nav-account-row").filter({ hasText: "ZZ Locked" });
    const mark = row.locator(".nav-link-status");
    await expect(mark).toBeVisible();
    const r = await box(row);
    const m = await box(mark);
    expect(m.x).toBeGreaterThanOrEqual(r.x);
    expect(m.x + m.width).toBeLessThanOrEqual(r.x + r.width);
    await mark.hover();
    const popup = page.locator(".status-popup");
    await expect(popup).toBeVisible();
    await expect.poll(async () => (await box(popup)).x).toBeGreaterThanOrEqual(0);
    const b = await box(popup);
    expect(b.x + b.width).toBeLessThanOrEqual(1024);
    expect(b.y + b.height).toBeLessThanOrEqual(700);
  });

  test("6 the rail shows no mark", async ({ page, request }) => {
    await twoRows(page, request);
    await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand/Collapse Sidebar", exact: true }).click();
    await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(0);
  });
});
