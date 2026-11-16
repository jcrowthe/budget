import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedReconcileCard } from "./support/reconcile-seed";
import { realClick } from "./support/register-seed";

// EXF-533, case 18. Built from the ticket; "not compared" with the source (nobody opened it for this feature).

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const reconcileBtn = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true });
const popover = (page: Page) => page.getByRole("dialog", { name: "Reconcile", exact: true });

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const box = async (l: Locator): Promise<Box> => {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
};
const noOverflow = (l: Locator) => l.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
const insideViewport = async (page: Page, l: Locator) => {
  const b = await box(l);
  const v = page.viewportSize() as { width: number; height: number };
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.right).toBeLessThanOrEqual(v.width);
  expect(b.bottom).toBeLessThanOrEqual(v.height);
};
const insideBox = (inner: Box, outer: Box) => {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
};

for (const [w, h] of [
  [1440, 900],
  [1024, 700],
] as const) {
  test(`the header, Reconcile and its states at ${w}x${h}`, async ({ page, request }) => {
    await page.setViewportSize({ width: w, height: h });
    const s = await seedReconcileCard(request);
    await page.goto(`/${s.plan}/accounts/${s.visa}`);
    await expect(button(page, "Add Transaction")).toBeVisible();
    const top = page.locator(".acct-head-top");
    await expect(page.locator(".acct-info")).toContainText("Reconciled a few seconds ago");
    await expect(page.locator("[data-balance=payment] .acct-payment-pill")).toBeVisible();

    // The top row holds the name, the info line, the pencil and Reconcile, with no overflow.
    for (const l of [top, page.locator(".acct-info"), page.locator(".acct-balances")]) {
      expect(await noOverflow(l)).toBe(true);
    }
    const topBox = await box(top);
    insideBox(await box(page.locator(".acct-head h1")), topBox);
    insideBox(await box(page.locator(".acct-info")), topBox);
    const actions = page.locator(".acct-actions");
    insideBox(await box(actions), topBox);
    expect(await actions.getByRole("button", { name: "Reconcile", exact: true }).count()).toBe(1);
    insideBox(await box(reconcileBtn(page)), topBox);
    // The balance row keeps its blocks and the Payment pill inside it.
    const balances = await box(page.locator(".acct-balances"));
    insideBox(await box(page.locator("[data-balance=payment]")), balances);
    // Reconcile is not in the toolbar or its More menu.
    const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
    await expect(toolbar.getByRole("button", { name: "Reconcile", exact: true })).toHaveCount(0);
    const more = toolbar.getByRole("button", { name: "More" });
    if ((await more.count()) > 0) {
      await more.click();
      await expect(page.getByRole("menu").getByText("Reconcile", { exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }

    // The popover, both steps.
    await realClick(page, reconcileBtn(page));
    await expect(popover(page).getByText("Is your current balance")).toBeVisible();
    await insideViewport(page, popover(page));
    expect(await noOverflow(popover(page))).toBe(true);
    await page.screenshot({
      path: `.screenshots/reconcile-popover-${w === 1440 ? 1440 : 1024}.png`,
    });
    await realClick(page, button(page, "No"));
    await expect(popover(page).getByText("Current balance at your bank")).toBeVisible();
    await insideViewport(page, popover(page));
    await page.screenshot({ path: `.screenshots/reconcile-enter-balance-${w}.png` });
    await page.keyboard.type("1234567.89");
    await page.keyboard.press("Enter");
    // The Difference modal.
    const modal = page.getByRole("dialog", { name: "Difference", exact: true });
    await expect(modal.getByText("Difference", { exact: true }).first()).toBeVisible();
    await insideViewport(page, modal);
    expect(await noOverflow(modal.locator(".form-body"))).toBe(true);
    await page.screenshot({ path: `.screenshots/reconcile-difference-${w}.png` });
    await realClick(page, modal.getByRole("button", { name: "Next", exact: true }));

    // The bar: one line, inside its box, with both buttons inside it.
    const bar = page.getByRole("region", { name: "Reconciliation", exact: true });
    const text = bar.locator(".reconcile-text");
    await expect(text).toContainText("$1,234,902.89");
    const t = await box(text);
    const lineHeight = await text.evaluate(
      (el) => Number.parseFloat(getComputedStyle(el).lineHeight) || 20,
    );
    expect(t.height).toBeLessThanOrEqual(lineHeight * 1.5);
    expect(await noOverflow(text)).toBe(true);
    const barBox = await box(bar);
    insideBox(t, barBox);
    for (const name of ["Cancel", "Create Adjustment & Finish"]) {
      insideBox(await box(bar.getByRole("button", { name, exact: true })), barBox);
    }
    await insideViewport(page, bar);
    await page.screenshot({ path: `.screenshots/reconcile-bar-higher-${w}.png` });
    await realClick(page, bar.getByRole("button", { name: "Cancel", exact: true }));

    // The save confirmation on a reconciled row.
    const row = page.locator(".register-table tbody tr[data-tx]").filter({ hasText: "ZZ Market" });
    await realClick(page, row.locator("td[data-field=payee]"));
    await realClick(page, row.locator("td[data-field=payee]"));
    const outflow = page.getByRole("textbox", { name: "Outflow", exact: true });
    await outflow.fill("336.00");
    await outflow.press("Enter");
    const confirm = page.getByRole("dialog", {
      name: "Save Changes to Reconciled Transaction",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await insideViewport(page, confirm);
    expect(await noOverflow(confirm.locator(".form-body"))).toBe(true);
    await page.screenshot({ path: `.screenshots/reconcile-edit-confirm-${w}.png` });
  });
}
