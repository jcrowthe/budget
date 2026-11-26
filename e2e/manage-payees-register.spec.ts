import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { delayRoute } from "./support/delay-route";
import { openManagePayees, seedPayees } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";

// A payee change made while the register's first transactions read is still in flight: the register follows it.
const btn = (d: ReturnType<Page["locator"]>, name: string) =>
  d.getByRole("button", { name, exact: true });
const pick = (d: ReturnType<Page["locator"]>, name: string) => btn(d, `Select ${name}`);

async function openEarly(page: Page, request: Parameters<typeof seedPayees>[0]) {
  const s = await seedPayees(request);
  await delayRoute(
    page,
    (url) => decodeURIComponent(url.pathname).endsWith(`/accounts/${s.checking}/transactions`),
    1_500,
  );
  // No wait for the register: the dialog opens while its first read is still held.
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  await expect(d.locator(".mp-name").first()).toBeVisible();
  await realClick(page, pick(d, "ZZ Cafe A"));
  return { s, d };
}

test("delete ZZ Cafe A with [No Payee] while the register loads: the register follows", async ({
  page,
  request,
}) => {
  const { d } = await openEarly(page, request);
  await realClick(page, btn(d, "Delete"));
  await realClick(page, btn(d, "Delete"));
  await expect(pick(d, "ZZ Cafe A")).toHaveCount(0);
  await realClick(page, btn(d, "Done"));
  const row = page.getByRole("row").filter({ hasText: "third" });
  await expect(row).toHaveCount(1, { timeout: 5_000 });
  await expect(row).not.toContainText("ZZ Cafe", { timeout: 5_000 });
});

test("rename ZZ Cafe A while the register loads: the register follows", async ({
  page,
  request,
}) => {
  const { d } = await openEarly(page, request);
  const input = d.getByRole("textbox", { name: "Payee Name", exact: true });
  await input.fill("ZZ Bistro");
  await input.press("Enter");
  await expect(pick(d, "ZZ Bistro")).toBeVisible();
  await realClick(page, btn(d, "Done"));
  const row = page.getByRole("row").filter({ hasText: "third" });
  await expect(row).toHaveCount(1, { timeout: 5_000 });
  await expect(row).not.toContainText("ZZ Cafe", { timeout: 5_000 });
  await expect(row).toContainText("ZZ Bistro", { timeout: 5_000 });
});
