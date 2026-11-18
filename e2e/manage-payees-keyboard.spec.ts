import { expect, test } from "./fixtures";
import { openManagePayees, seedPayees } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";

test.use({ viewport: { width: 1024, height: 700 } });

const LONG = `ZZ Long ${"x".repeat(112)}`;

test("15 keyboard: the list is one stop; Space ticks, Enter selects alone, Escape returns to the opener", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  await expect(d.getByRole("textbox", { name: "Search Payees", exact: true })).toBeFocused();
  // The list loads after the dialog opens: wait for its rows before using the keys.
  await expect(d.locator(".mp-name")).toHaveCount(5);
  await page.keyboard.press("Tab");
  const list = d.getByRole("listbox", { name: "Payees", exact: true });
  await expect(list).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(list).toHaveAttribute("aria-activedescendant", /^mp-r-/);
  await page.keyboard.press("Space");
  await expect(d.getByRole("checkbox", { name: "Check ZZ Cafe A", exact: true })).toBeChecked();
  await page.keyboard.press("Enter");
  const name = d.getByRole("textbox", { name: "Payee Name", exact: true });
  await expect(name).toHaveValue("ZZ Cafe A");
  for (let i = 0; i < 4 && !(await name.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(name).toBeFocused();
  // Tab never leaves the dialog.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Sidebar" })
      .getByRole("button", { name: s.name, exact: true }),
  ).toBeFocused();
});

test("16 narrow window: the dialog lies inside; the panes keep their widths; long text is cut with a title", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  await s.tx(LONG, { memo: `m ${"y".repeat(118)}` });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  const box = await d.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
  expect((await d.locator(".mp-left-pane").boundingBox())?.width).toBe(293);
  expect((await d.locator(".mp-main").boundingBox())?.width).toBeGreaterThanOrEqual(600);
  const long = d.getByRole("button", { name: `Select ${LONG}`, exact: true });
  await expect(long).toHaveAttribute("title", LONG);
  expect(await long.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await realClick(page, long);
  await realClick(page, d.getByRole("button", { name: "Show 1 Transaction", exact: true }));
  const pop = page.getByRole("dialog", { name: "Transactions", exact: true });
  const memo = pop.locator("tbody tr td:nth-child(4)");
  await expect(memo).toHaveAttribute("title", /^m y+/);
  expect(await memo.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const pb = await pop.boundingBox();
  expect((pb?.x ?? -1) + (pb?.width ?? 0)).toBeLessThanOrEqual(box.x + box.width);
  await realClick(page, pop.getByRole("button", { name: "Close", exact: true }));
  await realClick(page, d.getByRole("checkbox", { name: `Check ZZ Cafe A`, exact: true }));
  const sel = d.locator(".mp-selected-name").filter({ hasText: "ZZ Long" });
  await expect(sel).toHaveAttribute("title", LONG);
  expect(await sel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
