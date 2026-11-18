import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { newPlanDialog } from "./support/new-plan-seed";
import { card, cardLink, ownPlan } from "./support/plans-list-seed";
import { realClick } from "./support/real-click";

const columns = (page: Page) =>
  page
    .getByRole("list", { name: "Plans", exact: true })
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);

test("AC15 the cards wrap into fewer columns at 1024x700", async ({ page, request }) => {
  await ownPlan(request, "nw");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/plans");
  await expect(page.getByRole("button", { name: "Create New Plan", exact: true })).toBeVisible();
  const wide = await columns(page);
  await page.setViewportSize({ width: 1024, height: 700 });
  const narrow = await columns(page);
  expect(narrow).toBeLessThan(wide);
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fits).toBe(true);
});

test.describe("1024x700", () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test("AC15 a 100-character name is one cut line, and the dialogs lie inside the window", async ({
    page,
    request,
  }) => {
    const prefix = `${testName("long")} `;
    const name = prefix + "x".repeat(100 - prefix.length);
    expect(name).toHaveLength(100);
    const own = await ownPlan(request, "long", name);
    await page.goto("/plans");
    await expect(cardLink(page, own.name)).toBeVisible();
    const label = card(page, own.name).locator(".plans-list-name");
    const m = await label.evaluate((el) => ({
      cut: el.scrollWidth > el.clientWidth,
      overflow: getComputedStyle(el).textOverflow,
      title: el.getAttribute("title"),
      h: el.getBoundingClientRect().height,
      lh: parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height,
    }));
    expect(m.cut).toBe(true);
    expect(m.overflow).toBe("ellipsis");
    expect(m.title).toBe(own.name);
    expect(m.h).toBeLessThanOrEqual(m.lh + 1);

    const inside = async (loc: ReturnType<Page["locator"]>) => {
      const b = await loc.boundingBox();
      const vp = page.viewportSize();
      expect(
        b && vp && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height,
      ).toBe(true);
    };
    await card(page, own.name).hover();
    await realClick(
      page,
      card(page, own.name).getByRole("button", { name: "Delete Plan", exact: true }),
    );
    const del = page.getByRole("dialog", { name: "Delete Plan", exact: true });
    await expect(del).toBeVisible();
    await inside(del);
    await page.keyboard.press("Escape");
    await realClick(page, page.getByRole("button", { name: "Create New Plan", exact: true }));
    await expect(newPlanDialog(page)).toBeVisible();
    await inside(newPlanDialog(page));
  });
});
