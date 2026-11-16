import { expect, type Locator, type Page } from "@playwright/test";

/** Moves the mouse to the element's centre, checks it is the topmost element there, then clicks with the mouse. */
export async function realClick(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(
    await loc.evaluate(
      (el, [px, py]) => {
        const h = document.elementFromPoint(px as number, py as number);
        return !!h && (h === el || el.contains(h));
      },
      [x, y],
    ),
  ).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}
