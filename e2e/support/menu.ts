import { expect, type Locator, type Page } from "@playwright/test";
import { settle } from "./settled";

/**
 * Moves a real mouse to the centre of `target`, asserts that the element under the pointer is `target`
 * (or inside it) and that the box lies inside the window, then clicks. A locator click scrolls clipped
 * elements into view and so hid EXF-571; this does not.
 */
export async function mouseClick(page: Page, target: Locator, { click = true } = {}) {
  // Under load the box may not exist yet, may still be moving, or be covered: retry until it settles.
  const r = await settle(page, target, { inside: true });
  const b = r.box;
  expect(b).not.toBeNull();
  const vp = page.viewportSize();
  if (!b || !vp) throw new Error("no box or viewport");
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  expect(r.topmost).toBe(true);
  if (click) await page.mouse.click(x, y);
}
