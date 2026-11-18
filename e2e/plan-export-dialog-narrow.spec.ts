import { expect, test } from "./fixtures";
import { Plan } from "./support/plan-seed";

test.use({ viewport: { width: 1024, height: 700 } });

test("14 export half: keyboard, focus inside, box inside the window, focus returns", async ({
  page,
  request,
}) => {
  const plan = new Plan(request);
  await plan.create("expn");
  try {
    await plan.inflow(10);
    await page.goto(`/${plan.id}/budget`);
    const button = page.locator(".plan-button");
    await expect(button).toBeVisible();
    await button.focus();
    await page.keyboard.press("Enter");
    const menuItem = page.getByRole("menuitem", { name: "Export Plan", exact: true });
    await expect(menuItem).toBeVisible();
    for (let i = 0; i < 12; i++) {
      if (await menuItem.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export Plan", exact: true });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const vp = page.viewportSize();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp?.width ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(vp?.height ?? 0);
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press(i % 2 ? "Tab" : "Shift+Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  } finally {
    await plan.remove();
  }
});
