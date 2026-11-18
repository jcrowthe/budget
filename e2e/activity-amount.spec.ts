import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  addAmount,
  type AmountSeed,
  removeAmountPlan,
  seedAmounts,
} from "./support/activity-amount-seed";
import { patchPlan } from "./support/plan-formats-seed";
import { realClick } from "./support/real-click";

// EXF-745: an amount of up to twelve wide characters is whole in the Activity popover; a longer one is cut
// with an ellipsis and a title. Every number is the browser's own measure.

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
];

const dialog = (page: Page) => page.getByRole("dialog", { name: "Activity", exact: true });

async function openActivity(page: Page, s: AmountSeed) {
  await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
  await page.goto(`/${s.id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await realClick(
    page,
    page.locator(".category-row", { hasText: "ZZ Wide" }).locator(".activity-button"),
  );
  await expect(dialog(page).locator(".activity-table")).toBeVisible();
  await expect(dialog(page).locator(".activity-note")).toHaveCount(0);
}

const cell = (page: Page, text: string) =>
  dialog(page).locator(".activity-table td.num", { hasText: text });

const measure = (page: Page, text: string) =>
  cell(page, text).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      title: el.getAttribute("title"),
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      rowHeight: el.parentElement?.getBoundingClientRect().height ?? 0,
    };
  });

for (const size of SIZES) {
  test.describe(`activity amounts, ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, timezoneId: "UTC" });
    let s: AmountSeed;
    test.afterEach(async ({ request }) => {
      if (s) await removeAmountPlan(request, s);
    });

    test("5. amounts of 8, 10 and 12 wide characters are whole", async ({ page, request }) => {
      s = await seedAmounts(request);
      await openActivity(page, s);
      const texts = ["−$888.88", "$88,888.88", "−$888,888.88"];
      for (const text of texts) {
        await expect(cell(page, text)).toHaveText(text);
        const m = await measure(page, text);
        expect(
          m.scrollWidth,
          `${text}: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`,
        ).toBeLessThanOrEqual(m.clientWidth);
      }
      for (const text of texts) expect((await measure(page, text)).title).toBe(text);
      const r = await page.evaluate(() => {
        const b = document.querySelector(".activity-popover")?.getBoundingClientRect();
        return b && { l: b.left, t: b.top, r: b.right, b: b.bottom, w: innerWidth, h: innerHeight };
      });
      expect(r).toBeTruthy();
      expect(r?.l).toBeGreaterThanOrEqual(0);
      expect(r?.t).toBeGreaterThanOrEqual(0);
      expect(r?.r).toBeLessThanOrEqual(r?.w ?? 0);
      expect(r?.b).toBeLessThanOrEqual(r?.h ?? 0);
    });

    test("6. a 14-character amount is cut with an ellipsis and a title", async ({
      page,
      request,
    }) => {
      s = await seedAmounts(request);
      await patchPlan(request, s.id, {
        currency_format: {
          iso_code: "EUR",
          example_format: "123.456,78",
          symbol_placement: "after",
        },
      });
      await addAmount(request, s, -8_888_888_880);
      await openActivity(page, s);
      const long = await measure(page, "−8.888.888,88€");
      expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
      expect(long.textOverflow).toBe("ellipsis");
      expect(long.whiteSpace).toBe("nowrap");
      expect(long.title).toBe("−8.888.888,88€");
      const whole = await measure(page, "−888.888,88€");
      expect(whole.scrollWidth).toBeLessThanOrEqual(whole.clientWidth);
      expect(long.rowHeight).toBe(whole.rowHeight);
    });
  });
}
