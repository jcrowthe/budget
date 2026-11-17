import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { type ActivitySeed, removePlan, seedActivity } from "./support/activity-popover-seed";
import { realClick } from "./support/real-click";

// EXF-509 case 12: the popover lies wholly inside the window on the first, a middle and the last visible
// category row, with 30 rows in the list. Every number is the browser's own getBoundingClientRect.

const SIZES = [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
];

const dialog = (page: Page) => page.getByRole("dialog", { name: "Activity", exact: true });

for (const size of SIZES) {
  test.describe(`activity popover inside the window, ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, timezoneId: "UTC" });
    let s: ActivitySeed;
    test.afterEach(async ({ request }) => {
      if (s) await removePlan(request, s);
    });

    test("12. the popover stays inside the window on the first, a middle and the last visible row", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true, rows: 30, everywhere: true });
      await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
      await page.goto(`/${s.id}/budget/202611`);
      await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
      await expect(page.locator(".category-row .activity-button").first()).toBeVisible();
      // The visible rows with an Activity button: those whose box lies inside the grid body's visible part.
      const visible = async () =>
        page.evaluate(() => {
          const body = document.querySelector(".plan-body") as HTMLElement;
          const b = body.getBoundingClientRect();
          const head = document.querySelector(".header-row")?.getBoundingClientRect();
          const top = Math.max(b.top, head?.bottom ?? 0);
          return [...document.querySelectorAll(".category-row")]
            .map((r, i) => ({
              i,
              r: r.getBoundingClientRect(),
              has: !!r.querySelector(".activity-button"),
            }))
            .filter((x) => x.has && x.r.top >= top && x.r.bottom <= b.bottom)
            .map((x) => x.i);
        });
      const idx = await visible();
      expect(idx.length).toBeGreaterThan(2);
      const picks = [idx[0], idx[Math.floor(idx.length / 2)], idx[idx.length - 1]] as number[];
      for (const i of picks) {
        const b = page.locator(".category-row").nth(i).locator(".activity-button");
        await realClick(page, b);
        await expect(dialog(page).locator(".activity-list")).toBeVisible();
        // Wait until the rows have arrived.
        await expect(dialog(page).locator(".activity-note")).toHaveCount(0);
        const m = await page.evaluate(() => {
          const r = document.querySelector(".activity-popover")?.getBoundingClientRect();
          const list = document.querySelector(".activity-list") as HTMLElement;
          return {
            top: r?.top ?? -1,
            left: r?.left ?? -1,
            bottom: r?.bottom ?? 1e9,
            right: r?.right ?? 1e9,
            h: window.innerHeight,
            w: window.innerWidth,
            scrolls: list.scrollHeight > list.clientHeight,
            doc: document.scrollingElement?.scrollTop,
          };
        });
        expect(m.top, `row ${i}: top`).toBeGreaterThanOrEqual(0);
        expect(m.left, `row ${i}: left`).toBeGreaterThanOrEqual(0);
        expect(m.bottom, `row ${i}: bottom`).toBeLessThanOrEqual(m.h);
        expect(m.right, `row ${i}: right`).toBeLessThanOrEqual(m.w);
        expect(m.doc).toBe(0);
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toHaveCount(0);
      }
      // The 30-row category: its list scrolls inside the popover.
      const food = page
        .locator(".category-row", { hasText: "ZZ Food" })
        .locator(".activity-button");
      await realClick(page, food);
      await expect.poll(() => dialog(page).locator("tbody tr").count()).toBe(31);
      const scrolls = await page
        .locator(".activity-list")
        .evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(scrolls).toBe(true);
      const r = await dialog(page).boundingBox();
      expect((r?.y ?? -1) + (r?.height ?? 1e9)).toBeLessThanOrEqual(size.height);
      expect(r?.y ?? -1).toBeGreaterThanOrEqual(0);
    });
  });
}
