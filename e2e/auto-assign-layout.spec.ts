import {
  assign,
  autoCard,
  chip,
  fixedClock,
  MONTHLY,
  panel,
  putTarget,
  realClick,
  removePlan,
  type Seed,
  seedPlan,
} from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { GROCERIES, openPlan, PHONE, RENT } from "./plan-panel.fixtures";

test.use({ timezoneId: "UTC" });
const { at, today } = fixedClock();

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

const cardHeight = async (page: import("@playwright/test").Page) =>
  (await autoCard(page).boundingBox())?.height ?? 0;

test("EXF-616: the card has the source's height in every state", async ({ page, request }) => {
  // RENT is underfunded (target 100.00, nothing assigned); GROCERIES is overfunded (target 100.00, 150.00 assigned).
  await putTarget(request, s, RENT, MONTHLY, today);
  await putTarget(request, s, GROCERIES, MONTHLY, today);
  await assign(request, s, GROCERIES, 150000);
  await openPlan(page, s);
  // Underfunded and Reduce Overfunding both show: 8 rows in three groups (source arithmetic).
  expect(Math.abs((await cardHeight(page)) - 386)).toBeLessThanOrEqual(1);
  // One fully funded category ticked: 6 rows, no Underfunded.
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await cardHeight(page)) - 304)).toBeLessThanOrEqual(1);
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  // Without the overfunded category the card has 7 rows: 352.
  await assign(request, s, GROCERIES, 100000);
  await page.reload();
  await expect(page.locator(".category-row").first()).toBeVisible();
  await expect.poll(async () => Math.abs((await cardHeight(page)) - 352)).toBeLessThanOrEqual(1);
});

test("EXF-616: the height and the Notes card hold while the preview is held", async ({
  page,
  request,
}) => {
  await putTarget(request, s, RENT, MONTHLY, today);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await openPlan(page, s);
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await gate;
    await route.continue();
  });
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: RENT, exact: true })).toBeVisible();
  await expect(
    panel(page).locator("#panel-auto-assign button.auto-assign-option").first(),
  ).toBeVisible();
  const held = await cardHeight(page);
  const notes = await notesTop(page);
  release();
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible();
  expect(await cardHeight(page)).toBe(held);
  expect(await notesTop(page)).toBe(notes);
});

test("EXF-616: an empty view shows its message at once, in the card and in the Assign popover", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await new Promise(() => {});
    await route.continue();
  });
  await page.evaluate(() => {
    const w = window as unknown as { drawn: number };
    w.drawn = 0;
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (
            n instanceof Element &&
            (n.matches(".auto-assign-option") || n.querySelector(".auto-assign-option"))
          )
            w.drawn++;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await realClick(page, chip(page, "Snoozed"));
  await expect(panel(page).getByRole("button", { name: "View All Categories" })).toBeVisible();
  await expect(panel(page).locator(".auto-assign-option")).toHaveCount(0);
  await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
  const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
  await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
  await expect(dlg.getByRole("button", { name: "View All Categories" })).toBeVisible();
  await expect(dlg.locator(".auto-assign-option")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { drawn: number }).drawn)).toBe(0);
});

// EXF-624 was reversed by the Lead after the source was seen (live, 1600x813): with nothing ticked the card lists
// Underfunded even at $0.00 (352 px, also on a plan with no targets); with one category ticked it is hidden (304 px).
test("EXF-624 (as the source): Underfunded shows at $0.00 with nothing ticked, in the card and the popover, and hides for one category", async ({
  page,
}) => {
  await openPlan(page, s);
  const labels = (scope: import("@playwright/test").Locator) =>
    scope.locator("button.auto-assign-option > span");
  await expect(labels(panel(page)).first()).toBeVisible();
  const underfunded = (scope: import("@playwright/test").Locator) =>
    scope.locator("button.auto-assign-option", { hasText: /^Underfunded/ });
  await expect(underfunded(panel(page))).toContainText("$0.00");
  await expect(labels(panel(page)).filter({ hasText: /^Reduce Overfunding$/ })).toHaveCount(0);
  expect(Math.abs((await cardHeight(page)) - 352)).toBeLessThanOrEqual(1);
  await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
  const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
  await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
  await expect(underfunded(dlg)).toContainText("$0.00");
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  await expect(underfunded(panel(page))).toHaveCount(0);
});
