import { expect, test } from "./fixtures";
import {
  apply,
  applyFormat,
  budgetOf,
  field,
  openSettings,
  seedFormats,
  settingsDialog,
  sidebar,
  TODAY,
} from "./support/plan-formats-seed";
import { realClick } from "./support/real-click";

// EXF-468 acceptance 1 to 6, 13 (Assigned typing) and 19. The dialog is built from the ticket's text (not
// compared with the source in this Build); the plan page is the clone's own.

const open = async (page: import("@playwright/test").Page, id: string, name: string) => {
  await page.goto(`/${id}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await openSettings(page, name);
};
const texts = (l: import("@playwright/test").Locator) => l.allTextContents();
const patchCount = (page: import("@playwright/test").Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    // Opening a plan stamps it with a PATCH {opened: true}; that is not a setting.
    if (
      r.method() === "PATCH" &&
      /\/api\/v1\/budgets\/[^/]+$/.test(r.url()) &&
      !r.postData()?.includes('"opened"')
    )
      seen.push(r.url());
  });
  return seen;
};

test("1, 2. opens prefilled with the name focused and selected; the currency list is the ticket's", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  await open(page, s.plan, s.name);
  const name = field(page, "Plan Name");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue(s.name);
  expect(
    await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([0, s.name.length]);
  await expect(field(page, "Currency")).toHaveValue("USD");
  await expect(field(page, "Currency Placement")).toHaveValue("before");
  await expect(field(page, "Number Format")).toHaveValue("123,456.78");
  await expect(field(page, "Date Format")).toHaveValue("MM/DD/YYYY");
  const groups = settingsDialog(page).locator("#plan-settings-currency optgroup");
  await expect(groups).toHaveCount(2);
  expect(await groups.evaluateAll((g) => g.map((x) => x.getAttribute("label")))).toEqual([
    "Common Currencies",
    "All Currencies",
  ]);
  expect(await texts(groups.nth(0).locator("option"))).toEqual([
    "US Dollar–USD",
    "UK Pound Sterling–GBP",
    "Canadian Dollar–CAD",
    "Australian Dollar–AUD",
    "Euro–EUR",
  ]);
  const all = await texts(groups.nth(1).locator("option"));
  expect(all).toHaveLength(133);
  expect(all.slice(0, 3)).toEqual(["Albanian Lek–ALL", "Algerian Dinar–DZD", "Angolan Kwanza–AOA"]);
  expect(all.slice(-2)).toEqual(["Zambian Kwacha–ZMW", "Zimbabwe Dollar–ZWD"]);
  const year = new Date().getFullYear();
  expect(await texts(field(page, "Date Format").locator("option"))).toEqual([
    `${year}/12/30`,
    `${year}-12-30`,
    `30-12-${year}`,
    `30/12/${year}`,
    `30.12.${year}`,
    `12/30/${year}`,
    `${year}.12.30`,
  ]);
});

test("3, 4. JPY, KWD and SEK reset the number format and placement; EUR rewrites the labels", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  await open(page, s.plan, s.name);
  const nf = field(page, "Number Format");
  await field(page, "Currency").selectOption("JPY");
  expect(await texts(nf.locator("option"))).toEqual(["123.456", "123,456", "123 456"]);
  await expect(nf).toHaveValue("123,456");
  await field(page, "Currency").selectOption("KWD");
  expect(await texts(nf.locator("option"))).toEqual(["123,456.789"]);
  await field(page, "Currency").selectOption("SEK");
  await expect(nf).toHaveValue("123.456,78");
  await expect(field(page, "Currency Placement")).toHaveValue("after");
  await expect(field(page, "Currency Placement").locator("option:checked")).toHaveText(
    "After amount (123.456,78kr)",
  );
  await field(page, "Currency").selectOption("EUR");
  await expect(nf).toHaveValue("123,456.78");
  expect(await texts(field(page, "Currency Placement").locator("option"))).toEqual([
    "Before amount (€123,456.78)",
    "After amount (123,456.78€)",
    "Don't show (123,456.78)",
  ]);
});

test("5. Cancel, the close button and Escape discard every edit; no request is sent", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  const patches = patchCount(page);
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  for (const how of ["Cancel", "Close", "Escape"]) {
    await openSettings(page, s.name);
    await field(page, "Plan Name").fill("ZZ-TEST changed");
    await field(page, "Currency").selectOption("EUR");
    await field(page, "Number Format").selectOption("123.456,78");
    await field(page, "Currency Placement").selectOption("after");
    await field(page, "Date Format").selectOption("DD.MM.YYYY");
    if (how === "Escape") await page.keyboard.press("Escape");
    else
      await realClick(page, settingsDialog(page).getByRole("button", { name: how, exact: true }));
    await expect(settingsDialog(page)).toHaveCount(0);
    await openSettings(page, s.name);
    await expect(field(page, "Plan Name")).toHaveValue(s.name);
    await expect(field(page, "Currency")).toHaveValue("USD");
    await expect(field(page, "Number Format")).toHaveValue("123,456.78");
    await expect(field(page, "Currency Placement")).toHaveValue("before");
    await expect(field(page, "Date Format")).toHaveValue("MM/DD/YYYY");
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
  }
  expect(patches).toEqual([]);
  expect((await budgetOf(request, s.plan)).name).toBe(s.name);
});

test("6. Apply Settings sends one PATCH and everything follows without a reload", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  const patches = patchCount(page);
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  const available = page
    .locator(".category-row", { hasText: "D4 Groceries" })
    .locator(".cell-available");
  await expect(available).toContainText("−$1,234.56");
  await openSettings(page, s.name);
  await applyFormat(page, {
    currency: "EUR",
    numberFormat: "123.456,78",
    placement: "after",
    date: "DD.MM.YYYY",
  });
  expect(patches).toHaveLength(1);
  await expect
    .poll(async () => (await budgetOf(request, s.plan)).date_format.format)
    .toBe("DD.MM.YYYY");
  const b = await budgetOf(request, s.plan);
  expect(b.currency_format).toMatchObject({
    iso_code: "EUR",
    example_format: "123.456,78",
    symbol_first: false,
  });
  await expect(available).toContainText("−1.234,56€");
  await expect(available).not.toContainText("$");
  // The sidebar's balance follows (the account holds 2,500.00 less the outflow).
  await expect(sidebar(page)).toContainText("1.265,44€");
  // Focus is back on the plan button.
  await expect(sidebar(page).getByRole("button", { name: s.name, exact: true })).toBeFocused();
  // A register date follows.
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const [y, m, d] = TODAY.split("-");
  await expect(page.locator(".register-table tbody")).toContainText(`${d}.${m}.${y}`);
});

test("13. a Euro plan reads 1.234,56 typed into Assigned as 1,234,560 milliunits", async ({
  page,
  request,
}) => {
  const s = await seedFormats(request);
  await page.goto(`/${s.plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await openSettings(page, s.name);
  await applyFormat(page, { currency: "EUR", numberFormat: "123.456,78", placement: "after" });
  const row = page.locator(".category-row", { hasText: "D4 Groceries" });
  await row.locator(".assigned-box .amount").click();
  await page.keyboard.type("1.234,56");
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/categories\//.test(r.url()),
  );
  await page.keyboard.press("Enter");
  expect((await saved).ok()).toBe(true);
  const month = await (
    await request.get(`/api/v1/budgets/${s.plan}/months/${TODAY.slice(0, 7)}-01`, {
      headers: await (await import("./support/auth")).authHeaders(),
    })
  ).json();
  const cat = month.data.groups
    .flatMap((g: { categories: { name: string; assigned: number }[] }) => g.categories)
    .find((c: { name: string }) => c.name === "D4 Groceries");
  expect(cat.assigned).toBe(1234560);
  await expect(row.locator(".assigned-box .amount")).toHaveText("1.234,56€");
});

for (const size of [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
]) {
  test(`19. the dialog lies inside a ${size.width}x${size.height} window; an empty name shows an inline error and sends nothing; focus returns`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedFormats(request);
    const patches = patchCount(page);
    await open(page, s.plan, s.name);
    const box = await settingsDialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);
    await field(page, "Plan Name").fill("   ");
    await realClick(
      page,
      settingsDialog(page).getByRole("button", { name: "Apply Settings", exact: true }),
    );
    await expect(
      settingsDialog(page).getByText("Plan name is required.", { exact: true }),
    ).toBeVisible();
    await expect(settingsDialog(page)).toBeVisible();
    expect(patches).toEqual([]);
    await realClick(
      page,
      settingsDialog(page).getByRole("button", { name: "Cancel", exact: true }),
    );
    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(sidebar(page).getByRole("button", { name: s.name, exact: true })).toBeFocused();
    await openSettings(page, s.name);
    await field(page, "Plan Name").fill(`${s.name} two`);
    await apply(page);
    await expect(
      sidebar(page).getByRole("button", { name: `${s.name} two`, exact: true }),
    ).toBeVisible();
  });
}
