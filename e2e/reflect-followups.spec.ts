import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { addAccount, dateButton, NOW, newPlan, openReport, seedExample } from "./support/reflect";
import { seedSpendingExample } from "./support/spending-breakdown-seed";

// EXF-588: the Reflect frame's follow-ups (never another plan's figures, the axis, the anchoring).
// The page remount on a plan change protects first; the placeholder option is the second guard and is unit-tested in packages/schema/test/placeholder.test.ts.

/** Goes to another address without leaving the page (the app's own history, as a link would). */
const goClientSide = (page: Page, url: string) =>
  page.evaluate((u) => {
    history.pushState(null, "", u);
    dispatchEvent(new PopStateEvent("popstate"));
  }, url);

test("588-1 Net Worth never shows the previous plan's figures while the next plan loads", async ({
  page,
  request,
}) => {
  const x = await newPlan(request, "x");
  await seedExample(request, x.id);
  const y = await newPlan(request, "y");
  await addAccount(request, y.id, "Y Checking", "checking", 123450, "2026-11-02");
  await openReport(page, x.id, "net-worth");
  await expect(page.getByTestId("nw-total")).toHaveText("$19,299.26");
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/api/v1/budgets/${y.id}/reports/net-worth*`, async (route) => {
    await held;
    await route.continue();
  });
  await goClientSide(page, `/${y.id}/reflect/net-worth`);
  await expect(page).toHaveURL(`/${y.id}/reflect/net-worth`);
  for (const wait of [0, 1000, 1000]) {
    await page.waitForTimeout(wait);
    const body = page.locator("body");
    for (const stale of ["$19,299.26", "$24,049.26", "$4,750.00", "Oct 2026", "Jun 2026"]) {
      await expect(body).not.toContainText(stale);
    }
    await expect(page.getByTestId("nw-total")).toHaveCount(0);
  }
  release();
  await expect(page.getByTestId("nw-total")).toHaveText("$123.45");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("588-1 Spending Breakdown never shows the previous plan's figures either", async ({
  page,
  request,
}) => {
  const x = await seedSpendingExample(request);
  const y = await newPlan(request, "y");
  await openReport(page, x.plan.id, "spending-breakdown");
  await expect(page.getByTestId("sb-total")).toHaveText("$55.00");
  await expect(page.getByRole("button", { name: /^D8 Food/ })).toBeVisible();
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/api/v1/budgets/${y.id}/reports/spending-breakdown*`, async (route) => {
    await held;
    await route.continue();
  });
  await goClientSide(page, `/${y.id}/reflect/spending-breakdown`);
  await expect(page).toHaveURL(`/${y.id}/reflect/spending-breakdown`);
  for (const wait of [0, 1000, 1000]) {
    await page.waitForTimeout(wait);
    await expect(page.locator("body")).not.toContainText("$55.00");
    await expect(page.locator("body")).not.toContainText("D8 Food");
    await expect(page.getByTestId("sb-total")).toHaveCount(0);
  }
  release();
  await expect(page.getByTestId("sb-total")).toHaveText("$0.00");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("588-2 inside one plan the previous figures stay while the next range loads", async ({
  page,
  request,
}) => {
  const x = await newPlan(request, "x");
  await seedExample(request, x.id);
  await openReport(page, x.id, "net-worth");
  await expect(page.locator(".nw-table tbody tr")).toHaveCount(7);
  await page.route(
    `**/api/v1/budgets/${x.id}/reports/net-worth*start_month=2026-09-01*`,
    async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    },
  );
  await mouseClick(page, dateButton(page, "May 2026 – Nov 2026"));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "Last 3 Months", exact: true }));
  await page.waitForTimeout(300);
  // The previous range's rows and figures are still there during the read.
  await expect(page.locator(".nw-table tbody tr")).toHaveCount(7);
  await expect(page.getByTestId("nw-total")).toHaveText("$19,299.26");
  await expect(page.locator(".nw-table tbody tr")).toHaveCount(3);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("588-3 a balance under one dollar draws an axis with no repeated label", async ({
  page,
  request,
}) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") warnings.push(m.text());
  });
  const p = await newPlan(request, "cents");
  await addAccount(request, p.id, "Cents Checking", "checking", 400, "2026-11-02");
  await openReport(page, p.id, "net-worth");
  await expect(page.getByTestId("nw-total")).toHaveText("$0.40");
  await expect(page.locator(".nw-chart text.nw-tick:not(.nw-xlabel)")).toHaveText(["$0", "$1"]);
  expect(warnings.filter((w) => /same key|unique "key"/i.test(w))).toEqual([]);
});

for (const vp of [
  { width: 1600, height: 900 },
  { width: 1024, height: 700 },
]) {
  test.describe(`at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("588-4 the category popover scrolls inside itself; the date menu is anchored", async ({
      page,
      request,
    }) => {
      const p = await newPlan(request, "many");
      const h = await authHeaders();
      const g = await request.post(`/api/v1/budgets/${p.id}/category_groups`, {
        headers: h,
        data: { name: "ZZ Many" },
      });
      const gid = (await g.json()).data.category_group.id;
      for (let i = 0; i < 12; i++) {
        await request.post(`/api/v1/budgets/${p.id}/categories`, {
          headers: h,
          data: { group_id: gid, name: `Many ${i}` },
        });
      }
      await openReport(page, p.id, "spending-breakdown");
      await mouseClick(page, page.getByRole("button", { name: "All Categories", exact: true }));
      const pop = page.getByRole("dialog", { name: "Select Categories" });
      await expect(pop).toBeVisible();
      const m = await pop.evaluate((el) => {
        const list = el.querySelector(".filter-list") as HTMLElement;
        const r = el.getBoundingClientRect();
        return {
          width: r.width,
          bottom: r.bottom,
          client: list.clientHeight,
          scroll: list.scrollHeight,
        };
      });
      // The source's popover is 450 wide with a 304px list that scrolls inside it.
      expect(m.width).toBe(Math.min(450, vp.width - 16));
      expect(m.client).toBeLessThanOrEqual(304);
      expect(m.client).toBeLessThan(m.scroll);
      expect(m.bottom).toBeLessThanOrEqual(vp.height);
      const list = pop.locator(".filter-list");
      const b = await list.boundingBox();
      await page.mouse.move((b?.x ?? 0) + 100, (b?.y ?? 0) + 100);
      await page.mouse.wheel(0, 300);
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await mouseClick(page, pop.getByRole("button", { name: "Cancel", exact: true }));
      // The date menu: 240 wide, centred on the label, 15px under it (the source's anchoring).
      const label = dateButton(page, "Nov 2026");
      await mouseClick(page, label);
      const menu = page.getByRole("menu", { name: "Date range" });
      await expect(menu).toBeVisible();
      const lb = (await label.boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const mb = (await menu.boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      expect(mb.width).toBe(240);
      expect(Math.abs(mb.x + mb.width / 2 - (lb.x + lb.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(mb.y - (lb.y + lb.height + 15))).toBeLessThanOrEqual(1);
      expect(NOW.getFullYear()).toBe(2026);
    });
  });
}
