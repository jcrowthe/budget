import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { searchIds, seedSearch } from "./support/register-search-seed";

// EXF-528 (screens): the register search box. Suggestion wording follows the ticket; nothing was compared with
// the source beyond it.

const box = (page: Page) => page.getByRole("combobox", { name: /Find the transactions/ });
const options = (page: Page) => page.getByRole("option");
const labels = (page: Page) => page.locator('[role="option"] .search-option-description');
const rows = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const payees = async (page: Page) =>
  (await rows(page).locator("td[data-field=payee]").allInnerTexts()).map((t) => t.trim()).sort();
const rowIds = async (page: Page) =>
  (
    await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-tx") as string))
  ).sort();
const footer = (page: Page) => page.locator(".register-footer");
const HIDDEN = (first: string) => `Some transactions are hidden by your search for "${first}".`;

const open = async (page: Page, plan: string, account?: string) => {
  await page.goto(account ? `/${plan}/accounts/${account}` : `/${plan}/accounts`);
  await expect(rows(page).first()).toBeVisible();
};

test("AC1: corner offers the four Find entries; Payee: shows only matching payees, with the footer", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await expect(box(page)).toHaveAttribute("placeholder", "Search ZZ-TEST Checking");
  await box(page).fill("corner");
  await expect(options(page)).toHaveCount(4);
  await expect(labels(page)).toHaveText([
    'Find "corner" in any field',
    'Find "corner" in the Payee',
    'Find "corner" in the Category',
    'Find "corner" in the Memo',
  ]);
  await options(page).filter({ hasText: "in the Payee" }).click();
  await expect(box(page)).toHaveValue("Payee: corner, ");
  await expect(box(page)).toBeFocused();
  await expect(options(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  expect(await payees(page)).toEqual(["ZZ Corner Store"]);
  await expect(footer(page)).toContainText(HIDDEN("Payee: corner"));
  await expect(footer(page).getByRole("button", { name: "View All" })).toBeVisible();
});

test("AC2: is: lists the ten Is options in order", async ({ page, request }) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await box(page).fill("is:");
  await expect(labels(page).filter({ hasNotText: "Find" })).toHaveText([
    "Uncleared",
    "Cleared",
    "Reconciled",
    "Unreconciled",
    "Cleared or Reconciled",
    "Matched",
    "Approved",
    "Unapproved",
    "Needs Category",
    "Unapproved or Needs Category",
  ]);
  // A word inside a label finds it too.
  await box(page).fill("needs");
  await expect(labels(page).filter({ hasNotText: "Find" })).toHaveText([
    "Needs Category",
    "Unapproved or Needs Category",
  ]);
});

test("AC3: 20 offers three Outflow and three Inflow entries; more or equal writes Outflow: >=20,", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await box(page).fill("20");
  await expect(labels(page).filter({ hasNotText: "Find" })).toHaveText([
    "Outflow equals $20.00",
    "Outflow more or equal to $20.00",
    "Outflow less or equal to $20.00",
    "Inflow equals $20.00",
    "Inflow more or equal to $20.00",
    "Inflow less or equal to $20.00",
    "Enter month like 'Income: November 2026'",
  ]);
  await options(page).filter({ hasText: "Outflow more or equal to $20.00" }).click();
  await expect(box(page)).toHaveValue("Outflow: >=20, ");
});

test("AC4 and AC7: Is: Uncleared, Outflow: >=20, shows only rows meeting both, as the API does", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  const q = "Is: Uncleared, Outflow: >=20";
  await box(page).fill(`${q},`);
  await expect(footer(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  expect(await payees(page)).toEqual(["ZZ Corner Store", "ZZ Split Payee"]);
  const api = await searchIds(request, s.plan, q, s.checking);
  expect(await rowIds(page)).toEqual(api);
  expect(api).toEqual([s.ids.corner, s.ids.split].sort());
});

test("AC5: Category of a split line shows the parent with only the matching line", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await box(page).fill("Category: ZZ Fun, ");
  await expect(rows(page)).toHaveCount(1);
  expect(await payees(page)).toEqual(["ZZ Split Payee"]);
  const lines = page.locator("tr[data-line-of]");
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText("ZZ Fun");
});

test("AC6: the clear button and View All clear the search and every row returns", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  const all = await rowIds(page);
  expect(all.length).toBeGreaterThan(4);
  await box(page).fill("corner, ");
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(all.length);
  await expect(footer(page)).toHaveCount(0);
  await expect(box(page)).toBeFocused();

  await box(page).fill("Payee: corner, ");
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "View All" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(rows(page)).toHaveCount(all.length);
  await expect(box(page)).toBeFocused();
});

test("All Accounts: account lists every account; Account: shows only that account's rows", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan);
  await expect(box(page)).toHaveAttribute("placeholder", "Search All Accounts");
  await box(page).fill("account");
  await expect(labels(page).filter({ hasNotText: "Find" })).toHaveText([
    "ZZ-TEST Checking",
    "ZZ-TEST Savings",
  ]);
  await options(page).filter({ hasText: "ZZ-TEST Savings" }).click();
  await expect(box(page)).toHaveValue("Account: ZZ-TEST Savings, ");
  await expect(footer(page)).toBeVisible();
  const api = await searchIds(request, s.plan, "Account: ZZ-TEST Savings");
  expect(await rowIds(page)).toEqual(api);
  expect(await payees(page)).toContain("ZZ Savings Payee");
  expect(await payees(page)).not.toContain("ZZ Corner Store");
});

test("keyboard: ArrowDown and Enter choose, Escape closes the list and keeps the text; no match shows only the footer", async ({
  page,
  request,
}) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await box(page).fill("corner");
  await box(page).press("ArrowDown");
  await box(page).press("ArrowDown");
  await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await box(page).press("Enter");
  await expect(box(page)).toHaveValue("Payee: corner, ");
  await expect(rows(page)).toHaveCount(1);

  await box(page).fill("Memo: gift");
  await expect(options(page).first()).toBeVisible();
  await box(page).press("Escape");
  await expect(options(page)).toHaveCount(0);
  await expect(box(page)).toHaveValue("Memo: gift");

  await box(page).fill("zzz nothing matches this, ");
  await expect(rows(page)).toHaveCount(0);
  await expect(footer(page)).toContainText(HIDDEN("zzz nothing matches this"));
  await expect(page.getByText("No transactions", { exact: true })).toHaveCount(0);
});

test("a search is page state: it ends with the account", async ({ page, request }) => {
  const s = await seedSearch(request);
  await open(page, s.plan, s.checking);
  await box(page).fill("Payee: corner, ");
  await expect(rows(page)).toHaveCount(1);
  expect(new URL(page.url()).search).toBe("");
  await page.getByRole("link", { name: "ZZ-TEST Savings" }).first().click();
  await expect(box(page)).toHaveValue("");
  await expect(box(page)).toHaveAttribute("placeholder", "Search ZZ-TEST Savings");
});
