import type { Page } from "@playwright/test";
import {
  assign,
  autoCard,
  chip,
  fixedClock,
  MONTHLY,
  NEXT,
  option,
  optionLabels,
  panel,
  putTarget,
  readCategory,
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
import { GROCERIES, openPlan, PHONE, RENT, spend, UTILITIES } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { lastOfMonth, mcpCall, ordinal } from "./targets.fixtures";

test.use({ timezoneId: "UTC" });

const { at, today } = fixedClock();
const assignedBox = (page: Page, name: string) => row(page, name).locator(".assigned-box .amount");
const available = (page: Page, name: string) => row(page, name).locator(".available-pill");
const status = (page: Page, name: string) => row(page, name).locator(".status-label");
const check = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true }).click();

/** Click an option once the buttons are enabled (they are disabled while the month is read again). */
async function apply(page: Page, label: string) {
  const b = option(autoCard(page), label);
  await expect(b).toBeEnabled();
  await realClick(page, b);
}

/** The first worked example: monthly 100.00 target created in M, 100.00 assigned and 30.00 spent in M. */
async function worked(request: Parameters<typeof putTarget>[0], s: Seed) {
  await putTarget(request, s, RENT, MONTHLY, today);
  await assign(request, s, RENT, 100000);
  await spend(request, s, RENT, 30000);
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    let s: Seed;
    test.beforeEach(async ({ request, page }) => {
      await page.setViewportSize(size);
      await page.clock.setFixedTime(at);
      s = await seedPlan(request, "auto-assign");
    });
    test.afterEach(async ({ request }) => {
      await removePlan(request, s);
    });

    test("11. the card in its three states", async ({ page }) => {
      await openPlan(page, s);
      const card = autoCard(page);
      const plan = [
        "Underfunded",
        "Assigned Last Month",
        "Spent Last Month",
        "Average Assigned",
        "Average Spent",
        "Reset Available Amounts",
        "Reset Assigned Amounts",
      ];
      await expect(optionLabels(card)).toHaveText(plan);
      await expect(option(card, "Underfunded")).toContainText("$0.00");
      await expect(option(card, "Reduce Overfunding")).toHaveCount(0);
      // Source (live Plan page, 1600x813): buttons 32px tall, 2px between them, 16px between groups.
      const boxes = await card.locator("button.auto-assign-option").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, h: r.height };
        }),
      );
      expect(boxes.every((b) => Math.round(b.h) === 32)).toBe(true);
      expect(Math.round((boxes[1]?.top ?? 0) - (boxes[0]?.bottom ?? 0))).toBe(16);
      expect(Math.round((boxes[2]?.top ?? 0) - (boxes[1]?.bottom ?? 0))).toBe(2);
      expect(Math.round((boxes[5]?.top ?? 0) - (boxes[4]?.bottom ?? 0))).toBe(16);
      await expect(option(card, "Average Assigned")).toHaveAttribute(
        "title",
        "Feeling average? Fund all of your categories with your historical average assigned.",
      );
      await expect(option(card, "Average Spent")).toHaveAttribute(
        "title",
        "Assign your historical average spent. Though you're above average in my book.",
      );
      await expect(option(card, "Reset Available Amounts")).toHaveAttribute(
        "title",
        "Want to start from zero? Set the available amounts of all of your categories to $0.00, making the funds ready to assign. It's like a mini Fresh Start!",
      );
      await expect(option(card, "Reset Assigned Amounts")).toHaveAttribute(
        "title",
        "Reset all assigned amounts for this month, in case you want a do-over.",
      );
      await expect(option(card, "Underfunded")).not.toHaveAttribute("title", /./);
      await check(page, RENT);
      await expect(optionLabels(card)).toHaveText([
        "Assigned Last Month",
        "Spent Last Month",
        "Average Assigned",
        "Average Spent",
        "Reset Available Amount",
        "Reset Assigned Amount",
      ]);
      await check(page, PHONE);
      await expect(optionLabels(card)).toHaveText(plan);
    });

    test("12. the first worked example, click by click", async ({ page, request }) => {
      await worked(request, s);
      await openPlan(page, s, NEXT);
      await check(page, RENT);
      const card = autoCard(page);
      const amount = (label: string) => option(card, label).locator("strong");
      await expect(amount("Underfunded")).toHaveText("$100.00");
      await expect(amount("Assigned Last Month")).toHaveText("$100.00");
      await expect(amount("Spent Last Month")).toHaveText("$30.00");
      await expect(amount("Average Assigned")).toHaveText("$100.00");
      await expect(amount("Average Spent")).toHaveText("$30.00");
      await expect(amount("Reset Available Amount")).toHaveText("$0.00");
      await expect(amount("Reset Assigned Amount")).toHaveText("$0.00");
      const last = ordinal(Number(lastOfMonth(today, 1).slice(8)));
      await apply(page, "Spent Last Month");
      await expect(assignedBox(page, RENT)).toHaveText("$30.00");
      await expect(available(page, RENT)).toHaveText("$100.00");
      await expect(status(page, RENT)).toHaveText(`$70.00 more needed by the ${last}`);
      await apply(page, "Assigned Last Month");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await expect(available(page, RENT)).toHaveText("$170.00");
      await expect(status(page, RENT)).toHaveText("Funded");
      await apply(page, "Average Spent");
      await expect(assignedBox(page, RENT)).toHaveText("$30.00");
      await apply(page, "Average Assigned");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await apply(page, "Reset Available Amount");
      await expect(assignedBox(page, RENT)).toHaveText("−$70.00");
      await expect(available(page, RENT)).toHaveText("$0.00");
      await expect(status(page, RENT)).toHaveText(`$170.00 more needed by the ${last}`);
      await apply(page, "Reset Assigned Amount");
      await expect(assignedBox(page, RENT)).toHaveText("$0.00");
      await apply(page, "Underfunded");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      // This test is idle on the API for several seconds; the server closes an idle keep-alive socket after 5s,
      // so the request context can reuse a dead one (ECONNRESET). Setting an absolute amount is safe to repeat.
      for (let attempt = 0; ; attempt++) {
        try {
          await assign(request, s, RENT, 30000, NEXT);
          break;
        } catch (e) {
          if (attempt >= 2 || !/ECONNRESET|socket hang up/.test(String(e))) throw e;
        }
      }
      await page.reload();
      await check(page, RENT);
      await expect(amount("Underfunded")).toHaveText("$70.00");
      await apply(page, "Underfunded");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
    });

    test("13. Reduce Overfunding", async ({ page, request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      await assign(request, s, RENT, 150000);
      await assign(request, s, RENT, 250000, NEXT);
      await openPlan(page, s);
      await check(page, RENT);
      await expect(option(autoCard(page), "Reduce Overfunding").locator("strong")).toHaveText(
        "$50.00",
      );
      await apply(page, "Reduce Overfunding");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await expect(option(autoCard(page), "Reduce Overfunding")).toHaveCount(0);
      await page.reload();
      await page.goto(`/${s.id}/budget/${NEXT.slice(0, 7).replace("-", "")}`);
      await check(page, RENT);
      await expect(option(autoCard(page), "Reduce Overfunding").locator("strong")).toHaveText(
        "$150.00",
      );
    });

    test("14. multi-select applies per category", async ({ page, request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      await putTarget(request, s, PHONE, MONTHLY, today);
      await openPlan(page, s);
      await check(page, RENT);
      await check(page, PHONE);
      const sum = panel(page).locator(".panel-row", { hasText: /^Assigned in/ });
      await expect(sum.locator(".panel-row-value")).toHaveText("$0.00");
      await expect(option(autoCard(page), "Underfunded").locator("strong")).toHaveText("$200.00");
      await apply(page, "Underfunded");
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await expect(assignedBox(page, PHONE)).toHaveText("$100.00");
      await expect(sum.locator(".panel-row-value")).toHaveText("$200.00");
    });

    test("15. the Assign popover's Auto tab", async ({ page, request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      await putTarget(request, s, PHONE, MONTHLY, today);
      await openPlan(page, s);
      await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
      const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
      await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
      await expect(dlg.getByRole("tab", { name: "Auto", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const inDialog = await optionLabels(dlg).allInnerTexts();
      expect(inDialog).toEqual(await optionLabels(autoCard(page)).allInnerTexts());
      expect(inDialog).toContain("Reset Assigned Amounts");
      await expect(option(dlg, "Underfunded").locator("strong")).toHaveText("$200.00");
      await realClick(page, option(dlg, "Underfunded"));
      await expect(dlg).toHaveCount(0);
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await expect(assignedBox(page, PHONE)).toHaveText("$100.00");
    });

    test("16. a view scopes plan-wide runs; snoozed and hidden are left alone", async ({
      page,
      request,
    }) => {
      const U = RENT;
      const S = PHONE;
      const H = UTILITIES;
      const O = GROCERIES;
      await putTarget(
        request,
        s,
        U,
        { cadence: "monthly", behavior: "set_aside", amount: 60000 },
        today,
      );
      await putTarget(request, s, S, MONTHLY, today);
      await putTarget(
        request,
        s,
        H,
        { cadence: "monthly", behavior: "set_aside", amount: 25000 },
        today,
      );
      await assign(request, s, S, 50000);
      await assign(request, s, H, 5000);
      await assign(request, s, O, 10000);
      expect((await setSnooze(request, s, S, TODAY, true, today)).status()).toBe(200);
      const hide = await request.patch(`/api/v1/budgets/${s.id}/categories/${s.cat[H]}`, {
        headers: await authHeaders(),
        data: { hidden: true },
      });
      expect(hide.ok()).toBe(true);
      await openPlan(page, s);
      await realClick(page, chip(page, "Underfunded"));
      await expect(page.locator(".category-row")).toHaveCount(1);
      await expect(row(page, U)).toBeVisible();
      await expect(option(autoCard(page), "Underfunded").locator("strong")).toHaveText("$60.00");
      await apply(page, "Underfunded");
      const read = async (n: string) => (await readCategory(request, s, n, TODAY, today)).assigned;
      // U is funded now, so it leaves the Underfunded view.
      await expect.poll(() => read(U)).toBe(60000);
      await expect(page.locator(".category-row")).toHaveCount(0);
      expect([await read(U), await read(S), await read(H), await read(O)]).toEqual([
        60000, 50000, 5000, 10000,
      ]);
      const res = await request.post(
        `/api/v1/budgets/${s.id}/months/${TODAY}/auto-assign?today=${today}`,
        {
          headers: await authHeaders(),
          data: { strategy: "reset_assigned", view: "money_available" },
        },
      );
      expect(res.status()).toBe(200);
      const changed = (await res.json()).data.changed.map(
        (c: { category_id: string }) => c.category_id,
      );
      expect(changed.sort()).toEqual([s.cat[U], s.cat[S], s.cat[O]].sort());
      expect([await read(U), await read(S), await read(H), await read(O)]).toEqual([0, 0, 5000, 0]);
    });

    test("17. a second quick click applies nothing twice", async ({ page, request }) => {
      await putTarget(request, s, RENT, MONTHLY, today);
      await putTarget(request, s, PHONE, MONTHLY, today);
      await openPlan(page, s);
      await check(page, RENT);
      await check(page, PHONE);
      let posts = 0;
      let holding = false;
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      await page.route(/\/auto-assign\?/, async (route) => {
        if (route.request().method() === "POST") {
          posts++;
          holding = true;
        }
        await route.continue();
      });
      await page.route(/\/months\/\d{4}-\d{2}-01\?/, async (route) => {
        if (holding) await gate;
        await route.continue();
      });
      const b = option(autoCard(page), "Underfunded");
      await realClick(page, b);
      await expect(b).toBeDisabled();
      await expect.poll(() => posts).toBe(1);
      // A second click while the month is being read again does nothing.
      const box = await b.boundingBox();
      if (!box) throw new Error("not visible");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      expect(posts).toBe(1);
      release();
      await expect(assignedBox(page, RENT)).toHaveText("$100.00");
      await expect(assignedBox(page, PHONE)).toHaveText("$100.00");
      await expect(b).toBeEnabled();
      expect(posts).toBe(1);
      for (const name of [RENT, PHONE]) {
        await expect
          .poll(async () => (await readCategory(request, s, name, TODAY, today)).assigned)
          .toBe(100000);
      }
    });

    test("19. REST and MCP give the first example's previews and result", async ({ request }) => {
      await worked(request, s);
      const want = {
        category_count: 1,
        underfunded: 100000,
        assigned_last_month: 100000,
        spent_last_month: 30000,
        average_assigned: 100000,
        average_spent: 30000,
        paid_last_month: 0,
        average_paid: 0,
        reduce_overfunding: 0,
        reset_available: 0,
        reset_assigned: 0,
      };
      const res = await request.get(
        `/api/v1/budgets/${s.id}/months/${NEXT}/auto-assign?category_ids=${s.cat[RENT]}&today=${today}`,
        { headers: await authHeaders() },
      );
      expect((await res.json()).data).toEqual(want);
      const t = await mcpCall(request, "preview_auto_assign", {
        budget_id: s.id,
        month: NEXT,
        category_ids: [s.cat[RENT]],
        today,
      });
      expect(t).toEqual(want);
      const r = await mcpCall(request, "auto_assign", {
        budget_id: s.id,
        month: NEXT,
        strategy: "spent_last_month",
        category_ids: [s.cat[RENT]],
        today,
      });
      expect(r.changed).toEqual([{ month: NEXT, category_id: s.cat[RENT], assigned: 30000 }]);
      expect((await readMonth(request, s, NEXT, today)).groups.length).toBeGreaterThan(0);
    });
  });
}
