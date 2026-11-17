import { expect, test } from "./fixtures";
import {
  apply,
  applyFormat,
  openSettings,
  patchPlan,
  seedFormats,
  sidebar,
  TODAY,
} from "./support/plan-formats-seed";
import { realClick } from "./support/real-click";
import { addAccount, addTx, newPlan, openReport, seedExample } from "./support/reflect";
import { txs } from "./support/register-seed";
import { setViewSettings } from "./support/view-settings";

// EXF-468 criterion 6 and the "Looking" states 5 to 7: after Apply Settings every screen follows the plan's formats.

const EURO = {
  currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
  date_format: { format: "DD.MM.YYYY" },
};
const [Y, M, D] = TODAY.split("-");
const available = (page: import("@playwright/test").Page) =>
  page.locator(".category-row", { hasText: "D4 Groceries" }).locator(".cell-available");

test("Euro, 123.456,78, After amount, DD.MM.YYYY: grid, register, sidebar, Activity popover", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  await setViewSettings(request, s.plan, s.checking, { show_running_balance: true });
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await openSettings(page, s.name);
  await applyFormat(page, {
    currency: "EUR",
    numberFormat: "123.456,78",
    placement: "after",
    date: "DD.MM.YYYY",
  });
  await expect(available(page)).toContainText("−1.234,56€");
  const body = page.locator(".plan-body");
  await expect(body).not.toContainText("$");
  await expect(page.locator(".plan-header")).not.toContainText("$");
  // The sidebar's balances.
  await expect(sidebar(page)).toContainText("1.265,44€");
  await expect(sidebar(page)).not.toContainText("$");
  // The Activity popover: its date and amount.
  await realClick(
    page,
    page.locator(".category-row", { hasText: "D4 Groceries" }).locator(".activity-button"),
  );
  const popover = page.getByRole("dialog", { name: "Activity", exact: true });
  await expect(popover).toContainText(`${D}.${M}.${Y}`);
  await expect(popover).toContainText("1.234,56€");
  await page.keyboard.press("Escape");
  // The register, BALANCE column on.
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("columnheader", { name: "BALANCE", exact: true })).toBeVisible();
  const table = page.locator(".register-table tbody");
  await expect(table).toContainText(`${D}.${M}.${Y}`);
  await expect(table).toContainText("1.234,56€");
  await expect(table.locator("td.cell-balance").first()).toHaveText("1.265,44€");
  await expect(table).not.toContainText("$");
});

test("a Reflect report follows the plan's formats", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await patchPlan(request, id, EURO);
  await openReport(page, id, "net-worth");
  await expect(page.getByTestId("nw-total")).toHaveText("19.299,26€");
  await expect(page.getByTestId("nw-debts")).toHaveText("−4.750,00€");
  await expect(page.locator(".nw-table")).not.toContainText("$");
});

test("Japanese Yen: no decimals anywhere on the Plan page", async ({ page, request }) => {
  const s = await seedFormats(request);
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await openSettings(page, s.name);
  await expect(page.getByRole("dialog", { name: "Plan Settings", exact: true })).toBeVisible();
  await applyFormat(page, { currency: "JPY" });
  await expect(available(page)).toHaveText(/−¥1,235/);
  const text = await page.locator(".plan-body").innerText();
  expect(text).not.toMatch(/\d\.\d\d(?!\d)/);
  expect(text).not.toContain("$");
});

test("Don't show: no symbol on the Plan page or in the register", async ({ page, request }) => {
  const s = await seedFormats(request);
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await openSettings(page, s.name);
  await applyFormat(page, { placement: "none" });
  await expect(available(page)).toContainText("−1,234.56");
  await expect(available(page)).not.toContainText("$");
  await expect(page.locator(".plan-body")).not.toContainText("$");
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.locator(".register-table tbody")).toContainText("1,234.56");
  await expect(page.locator(".register-table tbody")).not.toContainText("$");
  await expect(page.locator(".register-table")).not.toContainText("$");
});

test("a register date typed in the plan's order is saved as that day", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  await patchPlan(request, s.plan, EURO);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("columnheader", { name: "DATE", exact: true })).toBeVisible();
  await realClick(page, page.getByRole("button", { name: "Add Transaction", exact: true }));
  const date = page.getByRole("textbox", { name: "Date", exact: true });
  await expect(date).toHaveAttribute("placeholder", "DD.MM.YYYY");
  await date.fill(`02.${M}.${Y}`);
  await page.getByRole("combobox", { name: "Payee", exact: true }).fill("ZZ typed");
  await page.getByRole("textbox", { name: "Outflow", exact: true }).fill("1.234,56");
  await realClick(page, page.getByRole("button", { name: "Save", exact: true }));
  await expect
    .poll(async () => {
      const rows = await txs(request, s.plan, s.checking);
      return rows.find((t) => t.amount === -1234560 && t.date === `${Y}-${M}-02`)?.date;
    })
    .toBe(`${Y}-${M}-02`);
  const rows = await txs(request, s.plan, s.checking);
  expect(rows.filter((t) => t.date === `${Y}-${M}-02`)).toHaveLength(1);
});
