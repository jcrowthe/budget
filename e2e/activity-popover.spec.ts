import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { row } from "./plan-panel.fixtures";
import { type ActivitySeed, removePlan, seedActivity } from "./support/activity-popover-seed";
import { seedCard } from "./support/card-seed";
import { realClick } from "./support/real-click";

// EXF-509: the Activity button of a category row and the popover that lists its transactions for the month.
// The plan and every row are made through the API; clicks use a real mouse; the clock is 2026-11-16 local noon.

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
];

const openPlan = async (page: Page, id: string) => {
  await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
  await page.goto(`/${id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(row(page, "ZZ Food")).toBeVisible();
};
const button = (page: Page, name = "ZZ Food") => row(page, name).locator(".activity-button");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Activity", exact: true });
const rowsOf = (page: Page) => dialog(page).locator("tbody tr");
const cells = (page: Page, i: number) => rowsOf(page).nth(i).locator("td").allInnerTexts();

for (const size of SIZES) {
  test.describe(`activity popover, ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, timezoneId: "UTC" });
    let s: ActivitySeed;
    test.afterEach(async ({ request }) => {
      if (s) await removePlan(request, s);
    });

    test("1. the amount is a button with its tooltip, and the row does not change", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true });
      await openPlan(page, s.id);
      const b = button(page);
      await expect(b).toHaveText("−$60.00");
      await expect(b).toHaveAttribute("title", "(−$60.00) View this category's monthly activity.");
      expect(await b.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
      // Source rule `.budget-number:hover { color: var(--actionPrimary) #7583ff; text-decoration: underline }`
      // (read from the source's CSSOM; no non-zero amount exists there to render it).
      await b.hover();
      const hov = await b.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, line: cs.textDecorationLine };
      });
      expect(hov).toEqual({ color: "rgb(117, 131, 255)", line: "underline" });
      // A zero row and a non-zero row have the same height, cell box, and right edge of the amount.
      const measure = (name: string) =>
        row(page, name).evaluate((r) => {
          const cell = r.querySelector(".cell-activity") as HTMLElement;
          const amount = cell.querySelector(".amount, .amount-zero, span") as HTMLElement;
          const c = cell.getBoundingClientRect();
          return {
            rowH: r.getBoundingClientRect().height,
            cellW: c.width,
            cellH: c.height,
            right: amount.getBoundingClientRect().right,
          };
        });
      const [full, zero] = [await measure("ZZ Food"), await measure("ZZ Empty")];
      expect(full.rowH).toBe(zero.rowH);
      expect(full.cellW).toBe(zero.cellW);
      expect(full.cellH).toBe(zero.cellH);
      expect(Math.abs(full.right - zero.right)).toBeLessThanOrEqual(1);
    });

    test("2. one row: the popover opens below the cell with its head and row", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true });
      await openPlan(page, s.id);
      await realClick(page, button(page));
      await expect(dialog(page)).toBeVisible();
      await expect(
        dialog(page).getByRole("heading", { name: "Activity", exact: true }),
      ).toBeVisible();
      await expect(dialog(page).locator(".activity-subtitle")).toHaveText("ZZ Food");
      await expect(dialog(page).locator("th")).toHaveText([
        "Account",
        "Date",
        "Payee",
        "Memo",
        "Amount",
      ]);
      await expect(rowsOf(page)).toHaveCount(1);
      expect(await cells(page, 0)).toEqual([
        "ZZ Checking",
        "11/15/2026",
        "ZZ Market",
        "",
        "−$60.00",
      ]);
      const [d, a] = [await dialog(page).boundingBox(), await button(page).boundingBox()];
      expect(d?.y ?? 0).toBeGreaterThan((a?.y ?? 0) + (a?.height ?? 0));
    });

    test("3. the five counted rows, newest first, and their sum is the Activity cell", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request);
      await openPlan(page, s.id);
      await expect(button(page)).toHaveText("−$110.00");
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(5);
      const all = await Promise.all([0, 1, 2, 3, 4].map((i) => cells(page, i)));
      expect(all.map((r) => r[4])).toEqual(["−$60.00", "$12.00", "−$30.00", "−$25.00", "−$7.00"]);
      expect(all.map((r) => r[1])).toEqual([
        "11/15/2026",
        "11/14/2026",
        "11/13/2026",
        "11/12/2026",
        "11/11/2026",
      ]);
      expect(all[3]?.[2]).toMatch(/^Transfer : /);
      expect(all[4]?.[0]).toBe("ZZ Old");
      const texts = (await dialog(page).innerText()).split("\n").join(" ");
      for (const absent of ["−$50.00", "−$20.00", "−$9.00", "−$40.00", "−$15.00"]) {
        expect(texts).not.toContain(absent);
      }
      await expect(dialog(page).locator(".activity-more")).toHaveCount(0);
    });

    test("8. a zero amount, a group row and a payment category have no button", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true });
      await openPlan(page, s.id);
      await expect(row(page, "ZZ Empty").locator(".cell-activity")).toBeVisible();
      await expect(button(page, "ZZ Empty")).toHaveCount(0);
      await expect(page.locator(".group-row .activity-button")).toHaveCount(0);
      await expect(page.locator(".activity-button")).toHaveCount(1);
      const card = await seedCard(request);
      try {
        await openPlan2(page, card.plan);
        const pay = page.locator(".category-row", { hasText: "ZZ-TEST Visa" });
        await expect(pay.locator(".cell-activity")).toBeVisible();
        await expect(pay.locator(".activity-button")).toHaveCount(0);
        await expect(button(page, "ZZ Groceries")).toHaveCount(1);
      } finally {
        await removePlan(request, { id: card.plan });
      }
    });

    test("9. Close, Escape and a mousedown outside close it; focus returns to the amount", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true });
      await openPlan(page, s.id);
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(1);
      await realClick(page, dialog(page).getByRole("button", { name: "Close", exact: true }));
      await expect(dialog(page)).toHaveCount(0);
      await expect(button(page)).toBeFocused();
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await expect(button(page)).toBeFocused();
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(1);
      await page.mouse.click(4, 4);
      await expect(dialog(page)).toHaveCount(0);
    });

    test("10. a long payee and memo are cut with an ellipsis and keep their full text in a tooltip", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true, long: true });
      await openPlan(page, s.id);
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(2);
      const long = rowsOf(page).filter({ hasText: "ZZ PPPP" });
      const [payee, memo] = [long.locator("td").nth(2), long.locator("td").nth(3)];
      for (const [cell, ch] of [
        [payee, "P"],
        [memo, "M"],
      ] as const) {
        await expect(cell).toHaveAttribute("title", `ZZ ${ch.repeat(117)}`);
        const m = await cell.evaluate((el) => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
          ellipsis: getComputedStyle(el).textOverflow,
          wrap: getComputedStyle(el).whiteSpace,
        }));
        expect(m.scroll).toBeGreaterThan(m.client);
        expect(m.ellipsis).toBe("ellipsis");
        expect(m.wrap).toBe("nowrap");
      }
    });

    test("11. with many rows the list scrolls inside the popover, not the window", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true, rows: 30 });
      await openPlan(page, s.id);
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(31);
      const m = await page.locator(".activity-list").evaluate((el) => ({
        scroll: el.scrollHeight,
        client: el.clientHeight,
        doc: document.scrollingElement?.scrollHeight,
        inner: window.innerHeight,
      }));
      expect(m.scroll).toBeGreaterThan(m.client);
      expect(m.doc).toBe(m.inner);
      await expect(
        dialog(page).getByRole("button", { name: "Close", exact: true }),
      ).toBeInViewport();
    });

    test("7. the popover says how many rows are not shown", async ({ page, request }) => {
      s = await seedActivity(request, { only: true });
      await openPlan(page, s.id);
      await page.route(/\/categories\/[^/]+\/transactions$/, async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        body.data.total_count += 3;
        await route.fulfill({ response: res, json: body });
      });
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(1);
      await expect(dialog(page).locator(".activity-more")).toHaveText(
        "3 more transactions not shown.",
      );
    });

    test("13. loading the page makes no transactions request; opening makes exactly one", async ({
      page,
      request,
    }) => {
      s = await seedActivity(request, { only: true });
      const seen: string[] = [];
      page.on("request", (r) => {
        if (/\/categories\/[^/]+\/transactions$/.test(new URL(r.url()).pathname))
          seen.push(r.url());
      });
      await openPlan(page, s.id);
      await page.waitForTimeout(500);
      expect(seen).toHaveLength(0);
      await realClick(page, button(page));
      await expect(rowsOf(page)).toHaveCount(1);
      await expect.poll(() => seen.length).toBe(1);
    });
  });
}

async function openPlan2(page: Page, id: string) {
  await page.goto(`/${id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row", { hasText: "ZZ-TEST Visa" })).toBeVisible();
}
