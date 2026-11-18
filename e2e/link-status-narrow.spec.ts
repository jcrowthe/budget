import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  box,
  newPlan,
  oneAccountBank,
  openDetail,
  openList,
  setup,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test.use({ viewport: { width: 1024, height: 700 } });

/** A stand-in plan with ZZ Linked linked to ZZ Checking, in the given state (the server's shape). */
async function open(
  page: Page,
  request: Parameters<typeof newPlan>[0],
  over: Parameters<typeof zzBank>[0],
  missing = false,
) {
  const z = zzBank({ last_synced_at: hoursAgo(1), ...over });
  const plan = await newPlan(request);
  const linked = await addAccount(request, plan, "ZZ Linked", "checking");
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [linked]: z.checking.id },
    missing: missing ? { [linked]: hoursAgo(2) } : {},
  });
  await page.goto(`/${plan}/accounts/${linked}`);
  await expect(page.locator(".acct-link-status")).toBeVisible();
  return { plan, linked };
}

/** The strip's buttons are whole and inside the main area; its sentence is not cut. */
async function stripFits(page: Page) {
  const main = await box(page.locator("main").first());
  const buttons = page.locator(".acct-connection-strip button");
  for (let i = 0; i < (await buttons.count()); i++) {
    const button = buttons.nth(i);
    await expect(button).toBeInViewport({ ratio: 1 });
    const b = await box(button);
    expect(b.x).toBeGreaterThanOrEqual(main.x);
    expect(b.x + b.width).toBeLessThanOrEqual(main.x + main.width);
    expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  expect(
    await page.locator(".acct-connection-text").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
}

/** The header's status name is whole, or cut with an ellipsis and a title that holds all of it. */
async function labelOk(page: Page) {
  const badge = page.locator(".acct-link-status");
  const label = badge.locator(".link-status-label");
  const text = (await label.textContent()) ?? "";
  const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth);
  if (cut) {
    expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    await expect(badge).toHaveAttribute("title", text);
  }
  const main = await box(page.locator("main").first());
  const b = await box(badge);
  expect(b.x + b.width).toBeLessThanOrEqual(main.x + main.width);
}

const popupInside = async (page: Page, popup: Locator) => {
  await expect(popup).toBeVisible();
  await expect.poll(async () => (await box(popup)).x).toBeGreaterThanOrEqual(0);
  const b = await box(popup);
  expect(b.x + b.width).toBeLessThanOrEqual(1024);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(700);
};

test("1 Account Not Found: the strip's two buttons and the header fit at 1024x700", async ({
  page,
  request,
}) => {
  await open(page, request, { status: "connected" }, true);
  await expect(page.locator(".acct-connection-strip button")).toHaveCount(2);
  await stripFits(page);
  await labelOk(page);
});

test("3 unavailable: the header's long name fits, with an ellipsis and a title if cut", async ({
  page,
  request,
}) => {
  await open(page, request, {
    status: "delayed",
    reason: "unavailable",
    last_synced_at: hoursAgo(96),
  });
  await stripFits(page);
  await labelOk(page);
});

test("4 reauthorization: the strip with Reauthorize fits at 1024x700", async ({
  page,
  request,
}) => {
  await open(page, request, { status: "login_required", reason: "reauthorize" });
  await stripFits(page);
  await labelOk(page);
});

test("5 broken: the header, the strip and the popup opened by a click lie inside the window", async ({
  page,
  request,
}) => {
  await open(page, request, { status: "broken" });
  await stripFits(page);
  await labelOk(page);
  await realClick(page, sidebar(page).locator(".nav-link-status").first());
  await popupInside(page, page.locator(".status-popup"));
});

test("2 Account Not Found: the popup opened by the keyboard lies inside the window", async ({
  page,
  request,
}) => {
  await open(page, request, { status: "connected" }, true);
  await sidebar(page)
    .locator(".nav-account-row")
    .filter({ hasText: "ZZ Linked" })
    .getByRole("link")
    .focus();
  await page.keyboard.press("Tab");
  const popup = page.locator(".status-popup");
  await popupInside(page, popup);
  // The title holds the whole name, on one line or wrapped inside the popup.
  await expect(popup.locator("strong")).toHaveText("Linked Account Not Found");
  expect(await popup.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("6 the row's line and a broken connection's badge are whole at 1024x700", async ({
  page,
  request,
}) => {
  await setup(page, request, (z) => [z.connection, oneAccountBank("ZZ Gone", "broken", "7a8b9c")], {
    missing: {},
  });
  const list = await openList(page);
  const badge = list.getByRole("button", { name: "ZZ Gone", exact: true }).locator(".mc-badge");
  await expect(badge).toHaveText("Connection Lost");
  const row = await box(list.getByRole("button", { name: "ZZ Gone", exact: true }));
  const b = await box(badge);
  expect(b.x).toBeGreaterThanOrEqual(row.x);
  expect(b.x + b.width).toBeLessThanOrEqual(row.x + row.width);
  expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("6 the detail's row line says Linked Account Not Found, whole or cut with a title", async ({
  page,
  request,
}) => {
  const z = zzBank({ status: "connected", last_synced_at: hoursAgo(1) });
  const plan = await newPlan(request);
  const lost = await addAccount(request, plan, "ZZ Linked", "checking");
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [lost]: z.checking.id },
    missing: { [lost]: hoursAgo(2) },
  });
  await page.goto(`/${plan}/budget`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  const detail = await openDetail(page, "ZZ Bank");
  const line = detail.locator(".mc-not-found");
  await expect(line).toHaveText("Linked Account Not Found");
  await expect(line).toHaveAttribute("title", "Linked Account Not Found");
  const d = await box(detail);
  const l = await box(line);
  expect(l.x + l.width).toBeLessThanOrEqual(d.x + d.width);
});
