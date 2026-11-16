import { expect, test } from "@playwright/test";
import { SHORTCUT_SECTIONS, SHORTCUTS } from "../apps/web/src/shortcuts/registry";
import { openPlan, PHONE, RENT, removePlan, row, seedPlan } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

async function newPlan(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("sc") },
  });
  return (await res.json()).data.budget.id as string;
}
const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Keyboard Shortcuts" });
const blankSpot = (page: import("@playwright/test").Page) => page.mouse.click(700, 8);

test("A1 ? opens the dialog on the plan, accounts and reflect pages, with the list from the registry", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  for (const path of [`/${id}/budget`, `/${id}/accounts`, `/${id}/reflect/net-worth`]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
    await blankSpot(page);
    await page.keyboard.press("?");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator("h3")).toHaveText(SHORTCUT_SECTIONS.map((s) => s.title));
    await expect(dialog(page).locator("li")).toHaveCount(SHORTCUTS.length);
    await expect(
      dialog(page).locator("li", { hasText: "Flag" }).locator(".key-cap.then"),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});

test("A3 OK, the close button and Escape close it; focus returns", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  const toggleBtn = page.getByRole("button", { name: "Expand/Collapse Sidebar" });
  await blankSpot(page);
  for (const how of ["ok", "close", "escape"]) {
    await page.keyboard.press("?");
    await expect(dialog(page)).toBeVisible();
    if (how === "ok")
      await realClick(page, dialog(page).getByRole("button", { name: "OK", exact: true }));
    else if (how === "close")
      await realClick(page, dialog(page).getByRole("button", { name: "Close", exact: true }));
    else await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
  await toggleBtn.focus();
  await page.keyboard.press("?");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggleBtn).toBeFocused();
});

test("A4 ? typed in a field types it", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await realClick(page, page.getByRole("navigation", { name: "Sidebar" }).locator(".plan-button"));
  await realClick(page, page.getByRole("menuitem", { name: "New Plan" }));
  const field = page.getByLabel("Plan Name");
  await field.focus();
  await page.keyboard.type("a?b");
  await expect(field).toHaveValue("a?b");
  await expect(dialog(page)).toHaveCount(0);
});

test("A5 the menu entry opens the dialog; A6 ? with a modal open does nothing", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  const planBtn = page.getByRole("navigation", { name: "Sidebar" }).locator(".plan-button");
  await realClick(page, planBtn);
  await page.keyboard.press("?");
  await expect(dialog(page)).toHaveCount(0);
  await realClick(page, page.getByRole("menuitem", { name: "Keyboard Shortcuts" }));
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("?");
  await expect(dialog(page)).toHaveCount(1);
});

test("A7 on macOS ctrl shows as ⌘", async ({ browser, request }) => {
  const id = await newPlan(request);
  const ctx = await browser.newContext({
    storageState: ".e2e-state/auth.json",
    baseURL: "http://localhost:4173",
  });
  await ctx.addInitScript(() => {
    // The helper prefers userAgentData; hide it so the platform string decides.
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
  });
  const page = await ctx.newPage();
  await page.goto(`/${id}/budget`);
  await page.mouse.click(700, 8);
  await page.keyboard.press("?");
  const row = dialog(page)
    .locator("li")
    .filter({ has: page.getByText("Select All", { exact: true }) });
  await expect(row.locator(".key-cap")).toHaveText(["⌘", "A"]);
  await ctx.close();
});

test("A9 Shift+. collapses and leaves the plan page's own keys alone", async ({
  page,
  request,
}) => {
  const seed = await seedPlan(request, "sc9");
  await openPlan(page, seed);
  await realClick(page, page.locator(".category-name", { hasText: RENT }));
  await expect(row(page, RENT)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(row(page, PHONE)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+.");
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toHaveClass(/is-collapsed/);
  await expect(row(page, PHONE)).toHaveAttribute("aria-selected", "true");
  await removePlan(request, seed);
});

test("P1 dialog rows are 45 high and the key caps group has no box of its own", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await blankSpot(page);
  await page.keyboard.press("?");
  const li = dialog(page).locator("li").first();
  // Source: each row is 45px high (padding 8 0, line-height 21), measured on the test plan's Plan page at 1600x813.
  await expect.poll(async () => Math.round((await li.boundingBox())?.height ?? 0)).toBe(45);
  // Source: .shortcut-keys has padding 0 and a transparent background (same measurement).
  const caps = li.locator(".key-caps");
  expect(await caps.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  expect(await caps.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  // Source: "Navigate the date picker" is 45 high, as the other rows (li has no gap; same measurement). Only
  // "Move to previous transaction field" wraps (59 high) in both.
  const nav = dialog(page).locator("li").filter({ hasText: "Navigate the date picker" });
  expect(Math.round((await nav.boundingBox())?.height ?? 0)).toBe(45);
});
