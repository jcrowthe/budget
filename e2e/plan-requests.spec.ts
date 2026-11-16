import {
  autoCard,
  fixedClock,
  realClick,
  removePlan,
  type Seed,
  seedPlan,
} from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { openPlan, RENT } from "./plan-panel.fixtures";

// The Plan page reads its month once: ticking a category and opening the Assign popover's Auto tab use the month
// the page already holds (the Auto-Assign list makes no request of its own).

test.use({ timezoneId: "UTC" });
const { at } = fixedClock();
const MONTH_READ = /\/api\/v1\/budgets\/[^/]+\/months\/\d{4}-\d{2}-01(\?[^/]*)?$/;

let s: Seed;
test.beforeEach(async ({ request, page }) => {
  await page.clock.setFixedTime(at);
  s = await seedPlan(request, "plan-requests");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

test("one month read on load, none more when a category is ticked or the Auto tab is opened", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && MONTH_READ.test(r.url())) reads.push(r.url());
  });
  await openPlan(page, s);
  await expect(autoCard(page).locator("button.auto-assign-option").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(reads, "on load").toHaveLength(1);
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await expect(page.getByRole("heading", { name: RENT, exact: true })).toBeVisible();
  await expect(autoCard(page).locator("button.auto-assign-option").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(reads, "after ticking").toHaveLength(1);
  await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
  const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
  await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
  await expect(dlg.locator("button.auto-assign-option").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(reads, "after opening the Auto tab").toHaveLength(1);
});
