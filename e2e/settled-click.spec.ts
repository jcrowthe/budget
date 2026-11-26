import { expect, test } from "@playwright/test";
import { mouseClick } from "./support/menu";
import { realClick } from "./support/real-click";

// A test page: one item enabled after 1 s (a `disabled` button, and an `aria-disabled` one), no app needed.
const PAGE = `<button id="a" disabled>Alpha</button>
<div role="menuitem" id="b" aria-disabled="true" tabindex="0">Beta</div>
<script>
  window.clicks = { a: 0, b: 0 };
  for (const id of ["a", "b"]) document.getElementById(id).addEventListener("click", () => window.clicks[id]++);
  setTimeout(() => {
    document.getElementById("a").disabled = false;
    document.getElementById("b").setAttribute("aria-disabled", "false");
  }, 1000);
</script>`;

const clicks = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { clicks: { a: number; b: number } }).clicks);

test("settle waits for a disabled button to become enabled, then clicks it once", async ({
  page,
}) => {
  await page.setContent(PAGE);
  const t0 = Date.now();
  await mouseClick(page, page.locator("#a"));
  expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  expect(await clicks(page)).toEqual({ a: 1, b: 0 });
});

test("settle waits for an aria-disabled item to become enabled, then clicks it once", async ({
  page,
}) => {
  await page.setContent(PAGE);
  const t0 = Date.now();
  await realClick(page, page.locator("#b"));
  expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  expect(await clicks(page)).toEqual({ a: 0, b: 1 });
});

test("allowDisabled presses a disabled control at once", async ({ page }) => {
  await page.setContent(PAGE);
  const t0 = Date.now();
  await realClick(page, page.locator("#b"), { allowDisabled: true });
  expect(Date.now() - t0).toBeLessThan(800);
  expect((await clicks(page)).b).toBe(1);
});
