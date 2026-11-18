import type { Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import { openImport, pairOf, planCsv, registerCsv } from "./support/plan-import-dialog-files";

// A loaded box answers slowly: wait far longer than the default 5 s.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(150_000);

test.use({ viewport: { width: 1024, height: 700 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import Plan", exact: true });

const LONG_PLAN = "P".repeat(100);
const LONG_ACCOUNT = "Account".padEnd(100, "x");
const LONG_FLAG = `${"flagword ".repeat(18)}end`;

function wide() {
  const row = (account: string, flag: string, date: string, payee: string, inflow: string) => [
    account,
    flag,
    date,
    payee,
    "Inflow: Ready to Assign",
    "Inflow",
    "Ready to Assign",
    "",
    "$0.00",
    inflow,
    "Cleared",
  ];
  const lines = Array.from({ length: 30 }, (_, i) =>
    row(i === 0 ? LONG_ACCOUNT : `Narrow ${i}`, "", "01/13/2026", "Starting Balance", "$100.00"),
  );
  lines.push(row("Narrow 1", LONG_FLAG, "01/14/2026", "Shop", "$1.00"));
  return pairOf("2026-11-15 19-51", LONG_PLAN, planCsv([]), registerCsv(lines));
}

test("14 import half: inside the window, long text cut or wrapped, the accounts scroll, the keyboard", async ({
  page,
}) => {
  await openImport(page);
  const opener = page.getByRole("button", { name: "Import Plan", exact: true });
  const d = dialog(page);
  const inside = async () => {
    const box = await d.boundingBox();
    const vp = page.viewportSize();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp?.width ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(vp?.height ?? 0);
  };
  await inside();
  // Enter on the drop zone opens the chooser.
  const zone = d.getByRole("button", { name: /Drop the files here/ });
  await expect(zone).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(wide());
  await expect(d.getByLabel("Plan name", { exact: true })).toHaveValue(/^P{100}$/);
  await inside();
  expect(
    await page.evaluate(() => (document.scrollingElement?.scrollHeight ?? 0) <= innerHeight),
  ).toBe(true);

  // The accounts scroll inside their box.
  const box = d.locator(".plan-import-dialog-accounts");
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // A long account name is cut and carries its full name as a tooltip.
  const cell = d.locator(".plan-import-dialog-name", { hasText: "Accountxxx" });
  await expect(cell).toHaveAttribute("title", LONG_ACCOUNT);
  expect(await cell.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // A long warning wraps inside the dialog.
  const warning = d.locator(".plan-import-dialog-list li", { hasText: "flagword" });
  await expect(warning).toBeVisible();
  const wb = await warning.boundingBox();
  const db = await d.boundingBox();
  expect((wb?.x ?? 0) + (wb?.width ?? 0)).toBeLessThanOrEqual((db?.x ?? 0) + (db?.width ?? 0));
  expect(wb?.height).toBeGreaterThan(30);
  expect(
    await d.locator(".plan-import-dialog-body").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);

  // Tab and Shift+Tab stay inside.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    expect(await d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(opener).toBeFocused();
});
