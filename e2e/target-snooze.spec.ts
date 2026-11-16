import {
  assign,
  autoCard,
  chip,
  fixedClock,
  MONTHLY,
  NEXT,
  option,
  putTarget,
  readCategory,
  realClick,
  removePlan,
  row,
  type Seed,
  SIZES,
  seedPlan,
  setSnooze,
  TODAY,
} from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { GROCERIES, openPlan, RENT } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { card, lastOfMonth, mcpCall } from "./targets.fixtures";

test.use({ timezoneId: "UTC" });

const { at, today } = fixedClock();
const YEARLY200 = (due: string) => ({
  cadence: "yearly",
  behavior: "set_aside",
  amount: 200000,
  due_date: due,
});
const status = (page: import("@playwright/test").Page, name: string) =>
  row(page, name).locator(".status-label");
const pill = (page: import("@playwright/test").Page, name: string) =>
  row(page, name).locator(".available-pill");
const select = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".category-name", { hasText: name }).click();
const sw = (page: import("@playwright/test").Page) =>
  card(page).getByRole("switch", { name: "Snooze target for this month" });

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    let s: Seed;
    test.beforeEach(async ({ request, page }) => {
      await page.setViewportSize(size);
      await page.clock.setFixedTime(at);
      s = await seedPlan(request, "target-snooze");
    });
    test.afterEach(async ({ request }) => {
      await removePlan(request, s);
    });

    test("7. snooze: status, pill, inspector and the views", async ({ page, request }) => {
      // Yearly set-aside 200.00 due the last day of next month, 40.00 assigned: 60.00 needed this month.
      await putTarget(request, s, RENT, YEARLY200(lastOfMonth(today, 1)), today);
      await assign(request, s, RENT, 40000);
      await openPlan(page, s);
      await expect(status(page, RENT)).toContainText("$60.00");
      await expect(status(page, RENT)).toContainText("more needed this month");
      await expect(pill(page, RENT)).toHaveClass(/cautious/);
      await select(page, RENT);
      await expect(option(autoCard(page), "Underfunded")).toContainText("$60.00");
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await realClick(page, sw(page));
      await expect(sw(page)).toHaveAttribute("aria-checked", "true");
      await expect(status(page, RENT)).toHaveCount(0);
      await expect(pill(page, RENT)).toHaveClass(/positive/);
      await expect(pill(page, RENT).locator("[data-icon=snooze]")).toHaveCount(1);
      await expect(pill(page, RENT)).toHaveAttribute(
        "title",
        "$40.00 Available to plan your spending—or click to move it to another category!",
      );
      await expect(card(page).getByText("To Go")).toBeVisible();
      await expect(option(autoCard(page), "Underfunded")).toHaveCount(0);
      await realClick(page, chip(page, "Underfunded"));
      await expect(row(page, RENT)).toHaveCount(0);
      await realClick(page, chip(page, "Snoozed"));
      await expect(page.locator(".category-row")).toHaveCount(1);
      await expect(row(page, RENT)).toBeVisible();
      await realClick(page, chip(page, "All"));
      // RENT is still the one selected category: a second click on its name would open its edit popover.
      await realClick(page, sw(page));
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await expect(status(page, RENT)).toContainText("$60.00");
      await expect(option(autoCard(page), "Underfunded")).toContainText("$60.00");
    });

    test("8. Shift+Z toggles, the tip shows once", async ({ page, request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      await openPlan(page, s);
      await realClick(page, page.getByRole("checkbox", { name: RENT, exact: true }));
      await page.keyboard.press("Shift+Z");
      await expect
        .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).target_snoozed)
        .toBe(true);
      const tip = page.getByRole("status").filter({
        hasText: "Keyboard Tip: Press shift Z to snooze a category's target",
      });
      await expect(tip).toBeVisible();
      await realClick(page, tip.getByRole("button", { name: "Close" }));
      await expect(tip).toHaveCount(0);
      await expect(status(page, RENT)).toHaveCount(0);
      await page.keyboard.press("Shift+Z");
      await expect
        .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).target_snoozed)
        .toBe(false);
      await expect(tip).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".category-row").first()).toBeVisible();
      await page.getByRole("checkbox", { name: RENT, exact: true }).click();
      await page.keyboard.press("Shift+Z");
      await expect
        .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).target_snoozed)
        .toBe(true);
      await expect(tip).toHaveCount(0);
    });

    test("9. other months: switch disabled with the extra sentence, target active", async ({
      page,
      request,
    }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      expect((await setSnooze(request, s, RENT, TODAY, true, today)).status()).toBe(200);
      await openPlan(page, s, NEXT);
      await select(page, RENT);
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await expect(sw(page)).toBeDisabled();
      await card(page).getByRole("button", { name: "About snoozing" }).hover();
      await expect(card(page).getByRole("tooltip")).toContainText(
        "You can only snooze targets in the current month.",
      );
      await expect(status(page, RENT)).toContainText("needed");
      await realClick(page, chip(page, "Snoozed"));
      await expect(
        page.getByText("You don't currently have categories with snoozed targets in this month."),
      ).toBeVisible();
    });

    test("10. refusals over REST and MCP, and the history", async ({ request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      const next = await setSnooze(request, s, RENT, NEXT, true, today);
      expect(next.status()).toBe(422);
      expect((await next.json()).error.detail).toBe(
        "You can only snooze targets in the current month.",
      );
      const none = await setSnooze(request, s, GROCERIES, TODAY, true, today);
      expect(none.status()).toBe(422);
      expect((await none.json()).error.detail).toBe("This category has no target to snooze.");
      expect((await readCategory(request, s, RENT, TODAY, today)).target_snoozed).toBe(false);
      const tool = (month: string, category: string) =>
        mcpCall(request, "snooze_target", {
          budget_id: s.id,
          month,
          category_id: s.cat[category],
          snoozed: true,
          today,
        });
      await expect(tool(NEXT, RENT)).rejects.toThrow();
      expect((await setSnooze(request, s, RENT, TODAY, true, today)).status()).toBe(200);
      // Deleting the target and setting it again leaves it not snoozed.
      await request.delete(`/api/v1/budgets/${s.id}/categories/${s.cat[RENT]}/target`, {
        headers: await authHeaders(),
      });
      await putTarget(request, s, RENT, MONTHLY, today);
      expect((await readCategory(request, s, RENT, TODAY, today)).target_snoozed).toBe(false);
    });
  });
}
