import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountData, planMonth, realClick, seedWorked } from "./support/register-seed";

const rows = (page: Page) => page.locator(".register-table tbody tr");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const balance = (page: Page, key: string) => page.locator(`[data-balance="${key}"] .acct-amount`);
const parentCategory = (page: Page) =>
  page.locator('.entry-row:not(.split-line) [data-field="category"] input');
const parentOutflow = (page: Page) =>
  page.locator('.entry-row:not(.split-line) [data-field="outflow"] input');
const line = (page: Page, i: number, field: string) =>
  page.locator(`[data-line="${i}"][data-field="${field}"] input`);
const SPLIT = "Split (Multiple Categories)...";

async function startSplit(page: Page, plan: string, checking: string, total: string) {
  await page.goto(`/${plan}/accounts/${checking}`);
  await expect(rows(page)).toHaveCount(3);
  await button(page, "Add Transaction").click();
  await parentOutflow(page).fill(total);
  await parentCategory(page).click();
  await realClick(page, button(page, "Split (Multiple Categories)"));
  await expect(parentCategory(page)).toHaveValue(SPLIT);
}

for (const size of [
  { width: 1600, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`the split editor, the remaining row and the dialog at ${size.width}x${size.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedWorked(request);
    const writes: string[] = [];
    page.on("request", (r) => {
      if (["POST", "PATCH"].includes(r.method()) && r.url().includes("/transactions")) {
        writes.push(`${r.method()} ${r.url()}`);
      }
    });
    await page.goto(`/${s.plan}/accounts/${s.checking}`);
    await expect(rows(page)).toHaveCount(3);
    await button(page, "Add Transaction").click();
    // The category footer: one full-width Split, no Payment/Transfer.
    await parentOutflow(page).fill("100");
    await parentCategory(page).click();
    await expect(button(page, "Payment/Transfer")).toHaveCount(0);
    await realClick(page, button(page, "Split (Multiple Categories)"));

    await expect(parentCategory(page)).toHaveValue(SPLIT);
    await expect(line(page, 0, "payee")).toHaveAttribute("placeholder", "payee");
    await expect(line(page, 1, "memo")).toHaveAttribute("placeholder", "memo");
    await expect(line(page, 2, "payee")).toHaveCount(0);
    await expect(button(page, "Remove split")).toHaveCount(2);
    await expect(page.getByText("Amount remaining to assign:", { exact: true })).toBeVisible();
    const remOut = page.locator('[data-field="remaining-outflow"]');
    const remIn = page.locator('[data-field="remaining-inflow"]');
    await expect(remOut).toHaveText("100.00");
    await expect(remIn).toHaveText("0.00");

    await line(page, 0, "outflow").fill("60");
    await line(page, 1, "outflow").fill("25");
    await expect(remOut).toHaveText("15.00");
    await expect(remIn).toHaveText("0.00");
    await line(page, 1, "outflow").fill("50");
    await expect(remOut).toHaveText("0.00");
    await expect(remIn).toHaveText("10.00");
    await line(page, 1, "outflow").fill("40");
    await expect(remOut).toHaveText("0.00");
    await expect(remIn).toHaveText("0.00");

    // Add another split focuses the new line; remove takes it away again.
    await realClick(page, button(page, "Add another split"));
    await expect(line(page, 2, "payee")).toBeFocused();
    await realClick(page, button(page, "Remove split").nth(2));
    await expect(line(page, 2, "payee")).toHaveCount(0);

    // 60 + 25 does not add up: the dialog.
    await line(page, 1, "outflow").fill("25");
    await button(page, "Save").click();
    const dialog = page.getByRole("dialog", { name: "Something Doesn't Add Up" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "The total is -$100.00, but the splits add up to -$85.00. How would you like to handle the unassigned -$15.00?",
    );
    // Adjust Manually and Escape close it.
    await realClick(page, button(page, "Adjust Manually"));
    await expect(dialog).toHaveCount(0);
    await button(page, "Save").click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(parentCategory(page)).toHaveValue(SPLIT);
    // Auto-Distribute: 70.59 and 29.41, nothing is sent.
    await button(page, "Save").click();
    await realClick(page, button(page, "Auto-Distribute"));
    await expect(dialog).toHaveCount(0);
    await expect(line(page, 0, "outflow")).toHaveValue("70.59");
    await expect(line(page, 1, "outflow")).toHaveValue("29.41");
    expect(writes).toEqual([]);

    // Update Total: the saved total is the lines' 85.00.
    await line(page, 0, "outflow").fill("60");
    await line(page, 1, "outflow").fill("25");
    await button(page, "Save").click();
    await realClick(page, button(page, "Update Total"));
    await expect
      .poll(async () => (await accountData(request, s.plan, s.checking)).transactions.length)
      .toBe(4);
    const saved = (await accountData(request, s.plan, s.checking)).transactions.find(
      (t) => t.subtransactions.length > 0,
    );
    expect(saved?.amount).toBe(-85000);
    expect(saved?.subtransactions.map((l) => l.amount)).toEqual([-60000, -25000]);
  });
}

test("a saved split: lines count in their categories, the chevron and the S key", async ({
  page,
  request,
}) => {
  const s = await seedWorked(request);
  const before = await planMonth(request, s.plan, s.month);
  await startSplit(page, s.plan, s.checking, "100");
  const pick = async (i: number, name: string) => {
    await line(page, i, "category").fill(name);
    await option(page, name).click();
  };
  await pick(0, "D4 Groceries");
  await line(page, 0, "outflow").fill("60");
  await pick(1, "D4 Dining");
  await line(page, 1, "outflow").fill("25");
  await realClick(page, button(page, "Add another split"));
  await line(page, 2, "payee").fill("D4 Toy Shop");
  await line(page, 2, "payee").press("Tab");
  await pick(2, "D4 Fun");
  await line(page, 2, "memo").fill("gift");
  await line(page, 2, "outflow").fill("15");
  await button(page, "Save").click();

  await expect
    .poll(async () => (await planMonth(request, s.plan, s.month)).activity[s.fun])
    .toBe((before.activity[s.fun] ?? 0) - 15000);
  const after = await planMonth(request, s.plan, s.month);
  expect(after.activity[s.groceries]).toBe((before.activity[s.groceries] ?? 0) - 60000);
  expect(after.activity[s.dining]).toBe((before.activity[s.dining] ?? 0) - 25000);
  expect(after.uncategorized).toBe(before.uncategorized);
  const data = await accountData(request, s.plan, s.checking);
  const parent = data.transactions.find((t) => t.subtransactions.length === 3);
  expect(parent?.amount).toBe(-100000);
  expect(parent?.subtransactions.map((l) => l.payee_name)).toEqual([null, null, "D4 Toy Shop"]);
  await expect(balance(page, "uncleared")).toHaveText("-$220.00");

  // Saved display: the chevron, three line rows, payee only on the line that has one.
  const lineRows = page.locator("tr.split-line-row");
  await expect(lineRows).toHaveCount(3);
  await expect(lineRows.nth(0).locator("td[data-field=payee]")).toHaveText("");
  await expect(lineRows.nth(2).locator("td[data-field=payee]")).toHaveText("D4 Toy Shop");
  await expect(lineRows.nth(2)).toContainText("gift");
  await expect(lineRows.nth(0)).toContainText("D4 Fun Group: D4 Groceries");
  const chevron = page.getByRole("button", { name: "Collapse split", exact: true });
  await expect(chevron).toHaveAttribute("aria-expanded", "true");
  await realClick(page, chevron);
  await expect(lineRows).toHaveCount(0);
  await realClick(page, page.getByRole("button", { name: "Expand split", exact: true }));
  await expect(lineRows).toHaveCount(3);

  // S on a selected saved row: two empty lines, the old category is not carried over.
  const plain = page.locator("tr[data-tx]").filter({ hasText: "D4 Fun Group: D4 Fun" });
  await plain.locator("td[data-field=memo]").click();
  await page.keyboard.press("S");
  await expect(parentCategory(page)).toHaveValue(SPLIT);
  await expect(line(page, 1, "payee")).toBeVisible();
  await expect(line(page, 0, "category")).toHaveValue("");
  await expect(line(page, 2, "payee")).toHaveCount(0);
  // S inside a field types the letter.
  await line(page, 0, "memo").focus();
  await page.keyboard.press("S");
  await expect(line(page, 0, "memo")).toHaveValue("S");
  await page.keyboard.press("Escape");
  await expect(page.locator(".entry-body")).toHaveCount(0);
});
