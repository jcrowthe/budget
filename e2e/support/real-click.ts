import { expect, type Locator, type Page } from "@playwright/test";
import { settle } from "./settled";

/** Moves the mouse to the element's centre, checks it is the topmost element there, then clicks with the mouse. */
export async function realClick(page: Page, loc: Locator) {
  // A card above may still be loading and moving its footer: wait (retrying) until the box is still and topmost.
  const r = await settle(page, loc, { scroll: true });
  if (!r.box) throw new Error("not visible");
  const x = r.box.x + r.box.width / 2;
  const y = r.box.y + r.box.height / 2;
  expect(r.topmost).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}
