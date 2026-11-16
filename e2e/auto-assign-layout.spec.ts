import { fixedClock, panel, removePlan, type Seed, seedPlan } from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { openPlan, PHONE, RENT } from "./plan-panel.fixtures";

test.use({ timezoneId: "UTC" });
const { at } = fixedClock();

let s: Seed;
test.beforeEach(async ({ request, page }) => {
  await page.clock.setFixedTime(at);
  s = await seedPlan(request, "auto-assign-layout");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const notesTop = async (page: import("@playwright/test").Page) => {
  const b = await panel(page).locator(".panel-card", { hasText: "Notes" }).last().boundingBox();
  if (!b) throw new Error("Notes card not visible");
  return Math.round(b.y);
};

test("the Notes card does not move while the Auto-Assign preview loads or the selection changes", async ({
  page,
}) => {
  await openPlan(page, s);
  // Hold every preview read back for one second.
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  for (const name of [RENT, PHONE]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
    await expect(panel(page).getByRole("heading", { name, exact: true })).toBeVisible();
    const during = await notesTop(page);
    // The preview has arrived once a button carries an amount.
    await expect(
      panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
    ).toBeVisible({ timeout: 5000 });
    expect(await notesTop(page), `after the preview of ${name}`).toBe(during);
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  // Moving the selection straight from one category to another.
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible({ timeout: 5000 });
  const before = await notesTop(page);
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  expect(await notesTop(page), "right after the selection moved").toBe(before);
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible({ timeout: 5000 });
  expect(await notesTop(page), "after the new preview").toBe(before);
});
