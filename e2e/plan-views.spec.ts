import {
  assign,
  autoCard,
  chip,
  fixedClock,
  group,
  monthLabel,
  option,
  panel,
  putTarget,
  readMonth,
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
import { GROCERIES, openPlan, PHONE, RENT, spend } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";

test.use({ timezoneId: "UTC" });

const { at, today } = fixedClock();

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    let s: Seed;
    test.beforeEach(async ({ request, page }) => {
      await page.setViewportSize(size);
      await page.clock.setFixedTime(at);
      s = await seedPlan(request, "plan-views");
    });
    test.afterEach(async ({ request }) => {
      await removePlan(request, s);
    });

    test("1. chips: All selected, no Overspent, no filter icon", async ({ page }) => {
      await openPlan(page, s);
      const names = ["All", "Underfunded", "Overfunded", "Money Available", "Snoozed"];
      for (const n of names) await expect(chip(page, n)).toBeVisible();
      await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
      await expect(chip(page, "Underfunded")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".view-chip")).toHaveCount(5);
      await expect(page.getByText("Overspent")).toHaveCount(0);
      // Measured on the source's Plan page (docs/plan-views-autoassign-design.md, "Chips"):
      // 24px tall, 12px/500, radius 5px, selected border #7583FF on #292C6C.
      const all = chip(page, "All");
      await expect(all).toHaveCSS("height", "24px");
      await expect(all).toHaveCSS("font-size", "12px");
      await expect(all).toHaveCSS("font-weight", "500");
      await expect(all).toHaveCSS("border-top-left-radius", "5px");
      await expect(all).toHaveCSS("border-top-color", "rgb(117, 131, 255)");
      await expect(all).toHaveCSS("background-color", "rgb(41, 44, 108)");
      await expect(chip(page, "Snoozed")).toHaveCSS("background-color", "rgb(60, 62, 83)");
    });

    test("2. Overspent: count, listed rows, subtotals, and it leaves when covered", async ({
      page,
      request,
    }) => {
      await spend(request, s, RENT, 10000);
      await spend(request, s, GROCERIES, 5000);
      await assign(request, s, PHONE, 25000);
      await openPlan(page, s);
      const over = chip(page, "2 Overspent");
      await expect(over).toBeVisible();
      await expect(page.locator(".view-chip").nth(1)).toHaveText("2 Overspent");
      await expect(over).toHaveCSS("background-color", "rgb(191, 46, 59)");
      await realClick(page, over);
      await expect(over).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".category-row")).toHaveCount(2);
      await expect(row(page, RENT)).toBeVisible();
      await expect(row(page, GROCERIES)).toBeVisible();
      await expect(row(page, PHONE)).toHaveCount(0);
      // Each group (Rent, Groceries live in two groups) sums only its listed row: Assigned, Activity, Available.
      const totals = await group(page).locator(".num").allInnerTexts();
      expect(totals).toEqual(["$0.00", "−$10.00", "−$10.00", "$0.00", "−$5.00", "−$5.00"]);
      // Covering one category (Reset Available Amount on it) leaves "1 Overspent"; covering both removes it.
      await realClick(page, page.getByRole("checkbox", { name: RENT, exact: true }));
      await realClick(page, option(autoCard(page), "Reset Available Amount"));
      await expect(chip(page, "1 Overspent")).toBeVisible();
      await expect(page.locator(".category-row")).toHaveCount(1);
      await realClick(page, page.getByRole("checkbox", { name: GROCERIES, exact: true }));
      await realClick(page, option(autoCard(page), "Reset Available Amount"));
      await expect(page.getByText("Overspent")).toHaveCount(0);
      await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".category-row").first()).toBeVisible();
    });

    test("3. Money Available lists only positive rows, with the footer and View All", async ({
      page,
      request,
    }) => {
      await assign(request, s, RENT, 50000);
      await spend(request, s, GROCERIES, 5000);
      await openPlan(page, s);
      const all = await page.locator(".category-row").count();
      await realClick(page, chip(page, "Money Available"));
      await expect(page.locator(".category-row")).toHaveCount(1);
      await expect(row(page, RENT)).toBeVisible();
      await expect(
        page.getByText("Some categories are hidden by your current view."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Category Group" })).toBeDisabled();
      await realClick(page, page.getByRole("button", { name: "View All", exact: true }));
      await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".category-row")).toHaveCount(all);
      await expect(page.getByRole("button", { name: "Category Group" })).toBeEnabled();
    });

    test("4. empty views show their message and View All", async ({ page, request }) => {
      await removePlan(request, s);
      s = await seedPlan(request, "plan-views-empty", 0);
      await openPlan(page, s);
      const empty: [string, string][] = [
        ["Underfunded", "You don't currently have any underfunded categories."],
        ["Overfunded", "You don't currently have any overfunded targets."],
        ["Money Available", "You don't currently have categories with money available."],
        ["Snoozed", "You don't currently have categories with snoozed targets in this month."],
      ];
      for (const [name, text] of empty) {
        await realClick(page, chip(page, name));
        await expect(page.getByText(text, { exact: true })).toBeVisible();
        await expect(page.getByRole("columnheader")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Category Group" })).toBeDisabled();
        await expect(autoCard(page).getByText("This view has no categories.")).toBeVisible();
        await realClick(page, page.getByRole("button", { name: "View All", exact: true }));
        await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("columnheader").first()).toBeVisible();
      }
      await realClick(page, chip(page, "Snoozed"));
      await realClick(page, autoCard(page).getByRole("button", { name: "View All Categories" }));
      await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
    });

    test("5. the view is not saved across a reload", async ({ page }) => {
      await openPlan(page, s);
      await realClick(page, chip(page, "Snoozed"));
      await expect(chip(page, "Snoozed")).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(page.locator(".view-chip").first()).toBeVisible();
      await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
    });

    test("6. the summary and both reads follow the view", async ({ page, request }) => {
      await putTarget(
        request,
        s,
        RENT,
        { cadence: "monthly", behavior: "set_aside", amount: 100000 },
        today,
      );
      await assign(request, s, RENT, 40000);
      await assign(request, s, PHONE, 25000);
      await assign(request, s, GROCERIES, 25000);
      expect((await setSnooze(request, s, RENT, TODAY, true, today)).status()).toBe(200);
      await openPlan(page, s);
      await realClick(page, chip(page, "Snoozed"));
      await expect(page.locator(".category-row")).toHaveCount(1);
      const here = monthLabel(TODAY);
      await expect(
        panel(page)
          .locator(".panel-row", { hasText: `Assigned in ${here}` })
          .locator(".panel-row-value"),
      ).toHaveText("$40.00");
      const sum = await request.get(
        `/api/v1/budgets/${s.id}/months/${TODAY}/summary?view=snoozed&today=${today}`,
        { headers: await authHeaders() },
      );
      expect((await sum.json()).data.assigned).toBe(40000);
      const m = await readMonth(request, s, TODAY, today, "&view=snoozed");
      expect(m.groups).toHaveLength(1);
      expect(m.groups[0].categories.map((c: { name: string }) => c.name)).toEqual([RENT]);
      expect(m.groups[0].assigned).toBe(40000);
    });
  });
}
