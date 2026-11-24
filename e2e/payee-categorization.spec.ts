import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openManagePayees } from "./support/manage-payees-seed";
import {
  addRow,
  type CategorizationSeed,
  categoryCombo,
  pickByMouse,
  pickByTab,
  seedCategorization,
} from "./support/payee-categorization-seed";
import { showOnlyPlans } from "./support/plans";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

async function open(page: import("@playwright/test").Page, s: { plan: string; checking: string }) {
  await showOnlyPlans(page, (p) => p.id === s.plan);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
}

test("A1 one Fun row: the add row fills Fun when the payee is picked by mouse", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one();
  await open(page, s);
  await addRow(page);
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Fun");
});

test("A1 one Fun row: the add row fills Fun when the payee is picked by Tab", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one();
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Fun");
});

test("A2 Groceries 11/10, 11/11, Fun 11/12: the add row fills Groceries (Tab)", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.majority();
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});

test("A2 Groceries 11/10, 11/11, Fun 11/12: the add row fills Groceries (mouse)", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.majority();
  await open(page, s);
  await addRow(page);
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});

test("A3 Groceries 11/10 then Fun 11/12: the add row fills Groceries", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.tie();
  await expect
    .poll(async () => (await s.payee(n)).default_category_id, { timeout: 15000 })
    .toBe(s.groceries);
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});

const AUTO = "Auto-categorize based on payee history";
const FIXED = "Always use my choice";
const radio = (card: Locator, name: string) => card.getByRole("radio", { name, exact: true });

/** Opens Manage Payees on the register page and selects one payee; returns the dialog and the card. */
async function manage(page: Page, s: CategorizationSeed, payee: string) {
  const d = await openManagePayees(page, s.name);
  await realClick(page, d.getByRole("button", { name: `Select ${payee}`, exact: true }));
  const card = d.locator(".mp-categorization");
  await expect(card.getByRole("heading", { name: "Categorization", exact: true })).toBeVisible();
  return { d, card };
}
const done = (page: Page, d: Locator) =>
  realClick(page, d.getByRole("button", { name: "Done", exact: true }));

test("A4 Always use my choice = Fun: the add row fills Fun over a Groceries history, and the API reads fixed", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = "ZZ Cafe Fixed";
  for (const date of ["2026-11-10", "2026-11-11", "2026-11-12"]) {
    await s.tx(n, { date, category_id: s.groceries });
  }
  await open(page, s);
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/payees/")) patches.push(r.url());
  });
  const { d, card } = await manage(page, s, n);
  await expect(radio(card, AUTO)).toBeChecked();
  await realClick(page, radio(card, FIXED));
  await expect(radio(card, FIXED)).toBeChecked();
  const field = card.getByRole("combobox", { name: "Category", exact: true });
  await expect(field).toBeVisible();
  expect(patches).toHaveLength(0);
  await realClick(page, field);
  await realClick(page, page.getByRole("option", { name: "Fun", exact: true }));
  await expect
    .poll(async () => await s.payee(n))
    .toMatchObject({
      category_mode: "fixed",
      fixed_category_id: s.fun,
      default_category_id: s.fun,
    });
  expect(patches).toHaveLength(1);
  await expect(field).toHaveValue("ZZ Daily: Fun");
  await done(page, d);
  await addRow(page);
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Fun");
});

test("A4 Do not auto-categorize: the category stays empty", async ({ page, request }) => {
  const s = await seedCategorization(request);
  const n = await s.one("ZZ Cafe Off");
  await open(page, s);
  const { d, card } = await manage(page, s, n);
  await realClick(page, radio(card, `Do not auto-categorize ${n}`));
  await expect.poll(async () => (await s.payee(n)).category_mode).toBe("off");
  await expect(card.getByText("Current default category:", { exact: false })).toHaveCount(0);
  await done(page, d);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+N");
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("");
});

test("A4 a category already chosen is never replaced", async ({ page, request }) => {
  const s = await seedCategorization(request);
  const hist = await s.one("ZZ Cafe One");
  const fixed = await s.one("ZZ Cafe Fixed");
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/payees/${await s.payeeId(fixed)}`, {
    category_mode: "fixed",
    fixed_category_id: s.fun,
  });
  await open(page, s);
  for (const n of [hist, fixed]) {
    await addRow(page);
    await categoryCombo(page).fill("Groceries");
    await expect(page.getByRole("option", { name: "Groceries", exact: true })).toBeVisible();
    await categoryCombo(page).press("Tab");
    await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
    await pickByTab(page, n);
    await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+N");
  }
});

test("A5 the card shows the default; last 3 transactions lists the three counted rows", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.majority();
  await open(page, s);
  const { d, card } = await manage(page, s, n);
  await expect(
    card.getByText("Current default category: ZZ Daily: Groceries", { exact: true }),
  ).toBeVisible();
  const link = card.getByRole("button", { name: "last 3 transactions", exact: true });
  await realClick(page, link);
  const pop = d.getByRole("dialog", { name: "Last 3 transactions", exact: true });
  await expect(pop).toBeVisible();
  await expect(pop.getByRole("columnheader")).toHaveText(["DATE", "CATEGORY", "AMOUNT"]);
  const rows = pop.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("td")).toHaveText(["11/12/2026", "Fun", "−$3.46"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["11/11/2026", "Groceries", "−$2.34"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["11/10/2026", "Groceries", "−$1.25"]);
  await expect(pop.getByText("11/13/2026")).toHaveCount(0);
  await realClick(page, pop.getByRole("button", { name: "Close", exact: true }));
  await expect(pop).toHaveCount(0);
  await expect(d).toBeVisible();
  await realClick(page, link);
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(d).toBeVisible();
  await expect(link).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
});

test("A5 a payee with no counted row shows Not yet set", async ({ page, request }) => {
  const s = await seedCategorization(request);
  const n = await s.empty();
  await open(page, s);
  const { card } = await manage(page, s, n);
  await expect(
    card.getByText("Current default category: Not yet set", { exact: true }),
  ).toBeVisible();
});

test("A5 a transaction save refreshes the card and the popover without a reload", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one("ZZ Cafe Fresh");
  await open(page, s);
  const { d, card } = await manage(page, s, n);
  await expect(
    card.getByText("Current default category: ZZ Daily: Fun", { exact: true }),
  ).toBeVisible();
  await realClick(page, card.getByRole("button", { name: "last 3 transactions", exact: true }));
  const pop = d.getByRole("dialog", { name: "Last 3 transactions", exact: true });
  await expect(pop.locator("tbody tr")).toHaveCount(1);
  await realClick(page, pop.getByRole("button", { name: "Close", exact: true }));
  await done(page, d);
  await addRow(page);
  await pickByTab(page, n);
  await categoryCombo(page).fill("Groceries");
  await categoryCombo(page).press("Tab");
  await page.getByRole("textbox", { name: "Outflow", exact: true }).fill("5");
  await realClick(page, page.getByRole("button", { name: "Save", exact: true }));
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
  const again = await manage(page, s, n);
  await expect(
    again.card.getByRole("button", { name: "last 3 transactions", exact: true }),
  ).toBeVisible();
  await realClick(
    page,
    again.card.getByRole("button", { name: "last 3 transactions", exact: true }),
  );
  await expect(
    again.d.getByRole("dialog", { name: "Last 3 transactions", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
});

test("refusal: the card shows the detail in its red bar", async ({ page, request }) => {
  const s = await seedCategorization(request);
  const n = await s.one("ZZ Cafe Refuse");
  await open(page, s);
  await page.route("**/api/v1/budgets/*/payees/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              id: "422",
              name: "unprocessable_entity",
              detail: "Category not found in this plan",
            },
          }),
        })
      : route.fallback(),
  );
  const { card } = await manage(page, s, n);
  await realClick(page, radio(card, FIXED));
  const field = card.getByRole("combobox", { name: "Category", exact: true });
  await realClick(page, field);
  await realClick(page, page.getByRole("option", { name: "Fun", exact: true }));
  await expect(card.getByRole("alert")).toHaveText("Category not found in this plan");
});

test("keys: arrows change and save the mode; Tab reaches the group once", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one("ZZ Cafe Keys");
  await open(page, s);
  const patches: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/payees/")) patches.push(r.url());
  });
  const { card } = await manage(page, s, n);
  await radio(card, AUTO).focus();
  await page.keyboard.press("Tab");
  await expect(
    card.getByRole("button", { name: "last 3 transactions", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(radio(card, AUTO)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radio(card, FIXED)).toBeChecked();
  expect(patches).toHaveLength(0);
  await page.keyboard.press("ArrowDown");
  await expect(radio(card, `Do not auto-categorize ${n}`)).toBeChecked();
  await expect.poll(async () => (await s.payee(n)).category_mode).toBe("off");
});

test("dimmed while deleting", async ({ page, request }) => {
  const s = await seedCategorization(request);
  const n = await s.one("ZZ Cafe Dim");
  await open(page, s);
  const { d, card } = await manage(page, s, n);
  await realClick(page, d.getByRole("button", { name: "Delete", exact: true }));
  await expect(card).toHaveCSS("opacity", "0.3");
  await expect(radio(card, AUTO)).toBeDisabled();
});

test("A6 a transfer payee and two selected payees show no Categorization", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const a = await s.one("ZZ Cafe One");
  const b = await s.one("ZZ Cafe Two");
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts`, {
    name: "ZZ Savings",
    type: "savings",
    balance: 100000,
    date: "2026-11-01",
  });
  await open(page, s);
  const d = await openManagePayees(page, s.name);
  await realClick(page, d.getByRole("button", { name: "Expand Transfer Payees", exact: true }));
  await realClick(
    page,
    d.getByRole("button", { name: "Select Transfer : ZZ Savings", exact: true }),
  );
  await expect(
    d.getByRole("heading", { name: "Transfer : ZZ Savings", exact: true }),
  ).toBeVisible();
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(0);
  await realClick(page, d.getByRole("checkbox", { name: `Check ${a}`, exact: true }));
  await expect(
    d.getByText("Only one payee group can be edited at a time.", { exact: false }),
  ).toBeVisible();
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(0);
  await realClick(page, d.getByRole("button", { name: "deselect transfer payees", exact: true }));
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(1);
  await realClick(page, d.getByRole("checkbox", { name: `Check ${b}`, exact: true }));
  await expect(d.getByRole("heading", { name: "2 Payees Selected", exact: true })).toBeVisible();
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(0);
});

for (const size of [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
]) {
  test(`A7 at ${size.width}x${size.height} the card fits the pane and the popover lies inside the window`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedCategorization(request);
    const n = await s.majority();
    await open(page, s);
    await addRow(page);
    await pickByTab(page, n);
    await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
    const tag = `${size.width}x${size.height}`;
    await page.screenshot({ path: `test-results/payee-categorization-add-row-${tag}.png` });
    await page.keyboard.press("Escape");
    const { d, card } = await manage(page, s, n);
    const main = d.locator(".mp-main");
    const inside = async () => {
      const m = (await main.boundingBox()) as { x: number; width: number };
      const c = (await card.boundingBox()) as { x: number; width: number };
      expect(c.x).toBeGreaterThanOrEqual(m.x);
      expect(c.x + c.width).toBeLessThanOrEqual(m.x + m.width);
      expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    };
    await inside();
    await card.screenshot({ path: `test-results/payee-categorization-card-${tag}.png` });
    await realClick(page, radio(card, FIXED));
    await inside();
    await realClick(page, radio(card, AUTO));
    await expect(radio(card, AUTO)).toBeChecked();
    await realClick(page, card.getByRole("button", { name: "last 3 transactions", exact: true }));
    const pop = d.getByRole("dialog", { name: "Last 3 transactions", exact: true });
    await expect(pop.locator("tbody tr")).toHaveCount(3);
    const p = (await pop.boundingBox()) as { x: number; y: number; width: number; height: number };
    const dlg = (await d.boundingBox()) as { x: number; y: number; width: number; height: number };
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(size.width);
    expect(p.y + p.height).toBeLessThanOrEqual(size.height);
    expect(p.x).toBeGreaterThanOrEqual(dlg.x);
    expect(p.x + p.width).toBeLessThanOrEqual(dlg.x + dlg.width);
    expect(p.y).toBeGreaterThanOrEqual(dlg.y);
    expect(p.y + p.height).toBeLessThanOrEqual(dlg.y + dlg.height);
    await page.screenshot({ path: `test-results/payee-categorization-popover-${tag}.png` });
  });
}

test("A12 the Always use my choice list has Inflow and the groups, and no credit card payment category (EXF-515)", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts`, {
    name: "ZZ Visa",
    type: "creditCard",
    balance: 100000,
    date: "2026-11-10",
  });
  const n = await s.one("ZZ Cafe Picker");
  await open(page, s);
  const { card } = await manage(page, s, n);
  await realClick(page, radio(card, FIXED));
  await realClick(page, card.getByRole("combobox", { name: "Category", exact: true }));
  const list = page.getByRole("listbox", { name: "Categories", exact: true });
  await expect(list.getByRole("option", { name: "Fun", exact: true })).toBeVisible();
  await expect(list.getByText("Inflow", { exact: true })).toBeVisible();
  await expect(list.getByText("Credit Card Payments", { exact: true })).toHaveCount(0);
  await expect(list.getByRole("option", { name: "ZZ Visa", exact: true })).toHaveCount(0);
});
