import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  openPlan,
  panel,
  RENT,
  removePlan,
  type Seed,
  seedPlan,
  TODAY,
} from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";

// EXF-586: after a plan switch the Plan page never shows the previous plan's month, at any network speed.

const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const planButton = (page: Page, name: string) =>
  side(page).getByRole("button", { name, exact: true });
const item = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true });
const sub = (page: Page) => page.getByRole("menu", { name: "Plans", exact: true });

let x: Seed;
let y: Seed;
test.beforeEach(async ({ request }) => {
  x = await seedPlan(request, "switch-x", 250000);
  y = await seedPlan(request, "switch-y", 0);
  const h = await authHeaders();
  const r = await request.patch(
    `/api/v1/budgets/${x.id}/months/${TODAY}/categories/${x.cat[RENT]}`,
    { headers: h, data: { assigned: 40000 } },
  );
  expect(r.ok()).toBe(true);
  const n = await request.patch(`/api/v1/budgets/${x.id}/months/${TODAY}`, {
    headers: h,
    data: { note: "Note X" },
  });
  expect(n.ok()).toBe(true);
  for (const p of [y, x])
    await request.patch(`/api/v1/budgets/${p.id}`, { headers: h, data: { opened: true } });
});
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await removePlan(request, x);
  await removePlan(request, y);
});

/** Only these two plans in the menu, whatever else the parallel suite opens. */
async function onlyOurPlans(page: Page) {
  await page.route("**/api/v1/budgets", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    body.data.budgets = body.data.budgets.filter(
      (b: { id: string }) => b.id === x.id || b.id === y.id,
    );
    return route.fulfill({ response: res, json: body });
  });
}

async function switchTo(page: Page, from: Seed, to: Seed) {
  await mouseClick(page, planButton(page, from.name));
  const open = item(page, "Open Plan");
  await mouseClick(page, open, { click: false });
  await expect(sub(page)).toBeVisible();
  const [ob, sb] = await Promise.all([open.boundingBox(), sub(page).boundingBox()]);
  await page.mouse.move((sb?.x ?? 0) + 20, (ob?.y ?? 0) + (ob?.height ?? 0) / 2);
  await mouseClick(page, sub(page).getByRole("menuitem", { name: to.name, exact: true }));
}

async function expectNothingOfX(page: Page, assignedBox: Locator) {
  await expect(page.locator(".category-row")).toHaveCount(0);
  await expect(page.getByText("$40.00")).toHaveCount(0);
  await expect(page.getByText("Note X")).toHaveCount(0);
  await expect(page.locator(".month-note")).toHaveAttribute("title", "");
  await expect(panel(page).getByText("$40.00")).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { name: RENT })).toHaveCount(0);
  await expect(assignedBox).toHaveCount(0);
  await expect(page.locator(".grid-body input")).toHaveCount(0);
}

test("switching plans shows nothing of the previous plan while the next month loads", async ({
  page,
}) => {
  await onlyOurPlans(page);
  await openPlan(page, x);
  await page.locator(".category-name", { hasText: RENT }).click();
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
  await expect(page.getByText("Note X")).toBeVisible();
  await expect(page.locator(".category-row").first().locator(".assigned-box")).toContainText(
    "$40.00",
  );

  await page.route(`**/api/v1/budgets/${y.id}/months/*`, async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue().catch(() => {});
  });
  const started = Date.now();
  await switchTo(page, x, y);
  await expect(page).toHaveURL(new RegExp(`/${y.id}/budget`));
  await expect(planButton(page, y.name)).toBeVisible();
  const assignedBox = page.locator(".assigned-box");
  await expectNothingOfX(page, assignedBox);
  await page.waitForTimeout(1000);
  expect(Date.now() - started).toBeLessThan(2000);
  await expectNothingOfX(page, assignedBox);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toHaveAttribute("aria-busy", "true");

  // Then the new plan's own figures.
  await expect(page.locator(".category-row").first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".category-row").first().locator(".assigned-box")).toContainText(
    "$0.00",
  );
  await expect(page.getByText("$40.00")).toHaveCount(0);
  await expect(page.getByText("Note X")).toHaveCount(0);
  await expect(panel(page)).toContainText("'s Summary");
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
});

test("changing the month inside one plan keeps the rows on screen while the next month loads", async ({
  page,
}) => {
  await openPlan(page, x);
  await page.route(`**/api/v1/budgets/${x.id}/months/*`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue().catch(() => {});
  });
  await mouseClick(page, page.getByRole("button", { name: "Next month", exact: true }));
  for (let i = 0; i < 6; i++) {
    expect(await page.locator(".category-row").count()).toBeGreaterThan(0);
    await page.waitForTimeout(100);
  }
  await expect(page.locator(".category-row").first()).toBeVisible();
});
