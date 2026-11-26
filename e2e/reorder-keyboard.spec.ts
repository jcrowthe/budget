import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newAccount, newPlan } from "./support/account-edit-seed";
import { authHeaders } from "./support/auth";

// EXF-496 / EXF-490 follow-ups: Alt+Shift+ArrowUp/ArrowDown on a focused row moves it one place (a keyboard
// alternative to dragging; our addition), says so in an aria-live region, and an account reorder is undone from
// the Plan (toolbar Undo or Ctrl+Z).

let planId = "";
test.beforeEach(async ({ request }) => {
  planId = await newPlan(request);
});
test.afterEach(async ({ request }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const RENT = "🏠 Rent/Mortgage";
const PHONE = "📱 Phone & Internet";
const UTILITIES = "⚡️ Utilities";

const openPlan = async (page: Page) => {
  await page.goto(`/${planId}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row .category-name").first()).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const bills = (page: Page) =>
  page
    .locator(".group-block", { has: page.locator(".group-row .group-name", { hasText: "Bills" }) })
    .locator(".category-row .category-name");
const groupNames = (page: Page) => page.locator(".group-row .group-name");
const live = (page: Page) => page.locator("[aria-live]").filter({ hasText: /Moved/ });
const cashNames = (page: Page) =>
  page.locator('[data-group="cash"] .nav-account-row .name').allTextContents();

test("a category moves up with Alt+Shift+ArrowUp, is announced, and persists", async ({ page }) => {
  await openPlan(page);
  await expect(bills(page)).toHaveText([RENT, PHONE, UTILITIES]);
  // The selected category moves (the Plan's own keyboard model: no row is a Tab stop).
  await page.locator(".category-name", { hasText: UTILITIES }).click();
  await expect(catRow(page, UTILITIES)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(bills(page)).toHaveText([RENT, UTILITIES, PHONE]);
  await expect(live(page)).toContainText(/Moved .*Utilities.* to position 2 of 3/);
  await expect(catRow(page, UTILITIES)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".category-row[aria-selected=true]")).toHaveCount(1);
  await page.reload();
  await expect(bills(page)).toHaveText([RENT, UTILITIES, PHONE]);
});

test("a group moves down with Alt+Shift+ArrowDown and persists", async ({ page }) => {
  await openPlan(page);
  const before = await groupNames(page).allTextContents();
  const i = before.findIndex((n) => n.includes("Bills"));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(i).toBeLessThan(before.length - 1);
  const name = page.locator(".group-row button.group-name", { hasText: "Bills" });
  await name.focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  const want = [...before];
  [want[i], want[i + 1]] = [want[i + 1], want[i]];
  await expect(groupNames(page)).toHaveText(want);
  await expect(live(page)).toContainText(/Moved .*Bills/);
  await expect(name).toBeFocused();
  await page.reload();
  await expect(groupNames(page)).toHaveText(want);
});

test("Tab from a group's name control does not land on a category row", async ({ page }) => {
  await openPlan(page);
  await page.locator(".group-row button.group-name").first().focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains("category-row")),
    ).toBe(false);
  }
});

test("an account moves with Alt+Shift+ArrowUp, is announced, and persists", async ({
  page,
  request,
}) => {
  for (const n of ["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]) await newAccount(request, planId, n);
  await openPlan(page);
  expect(await cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]);
  await page.locator(".nav-account-link", { hasText: "ZZ-TEST C" }).focus();
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect.poll(() => cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST C", "ZZ-TEST B"]);
  await expect(live(page)).toContainText(/Moved .*ZZ-TEST C.* to position 2 of 3/);
  await page.reload();
  await expect.poll(() => cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST C", "ZZ-TEST B"]);
});

test("an account reorder is undone from the Plan toolbar, and by Ctrl+Z", async ({
  page,
  request,
}) => {
  for (const n of ["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]) await newAccount(request, planId, n);
  await openPlan(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const reorder = async () => {
    await page.locator(".nav-account-link", { hasText: "ZZ-TEST C" }).focus();
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await expect.poll(() => cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST C", "ZZ-TEST B"]);
  };
  await reorder();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]);
  await reorder();
  await expect(undo).toBeEnabled();
  await page
    .locator(".plan-header, body")
    .first()
    .click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => cashNames(page)).toEqual(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]);
});

// Moving a category across a group edge (our addition): the first category of a group goes to the end of the
// previous visible group, the last to the start of the next; a payment category never leaves its group.
const blockNames = (page: Page, group: string) =>
  page
    .locator(".group-block", { has: page.locator(".group-row .group-name", { hasText: group }) })
    .locator(".category-row .category-name");
const nameOf = async (page: Page, i: number) =>
  ((await groupNames(page).nth(i).textContent()) ?? "").trim();
const select = async (page: Page, name: string) => {
  await page.locator(".category-name", { hasText: name }).click();
  await expect(catRow(page, name)).toHaveAttribute("aria-selected", "true");
};

test("the first category of a group moves to the end of the previous group", async ({ page }) => {
  await openPlan(page);
  const names = await groupNames(page).allTextContents();
  const bi = names.findIndex((n) => n.includes("Bills"));
  expect(bi).toBeGreaterThan(0);
  const prev = names[bi - 1].trim();
  const prevCats = await blockNames(page, prev).allTextContents();
  await select(page, RENT);
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(blockNames(page, prev)).toHaveText([...prevCats, RENT]);
  await expect(bills(page)).toHaveText([PHONE, UTILITIES]);
  await expect(live(page)).toContainText(new RegExp(`Moved .*Rent.* to ${prev}`));
  await expect(catRow(page, RENT)).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(blockNames(page, prev)).toHaveText([...prevCats, RENT]);
  await expect(bills(page)).toHaveText([PHONE, UTILITIES]);
});

test("the last category of a group moves to the start of the next group", async ({ page }) => {
  await openPlan(page);
  const names = await groupNames(page).allTextContents();
  const bi = names.findIndex((n) => n.includes("Bills"));
  expect(bi).toBeLessThan(names.length - 1);
  const next = names[bi + 1].trim();
  const nextCats = await blockNames(page, next).allTextContents();
  await select(page, UTILITIES);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(blockNames(page, next)).toHaveText([UTILITIES, ...nextCats]);
  await expect(bills(page)).toHaveText([RENT, PHONE]);
  await expect(live(page)).toContainText(new RegExp(`Moved .*Utilities.* to ${next}`));
  await expect(catRow(page, UTILITIES)).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(blockNames(page, next)).toHaveText([UTILITIES, ...nextCats]);
});

test("a payment category does not leave the Credit Card Payments group", async ({
  page,
  request,
}) => {
  await newAccount(request, planId, "ZZ-TEST Card", "creditCard");
  await openPlan(page);
  const first = await nameOf(page, 0);
  expect(first).toContain("Credit Card Payments");
  const pay = blockNames(page, "Credit Card Payments");
  const before = await pay.allTextContents();
  expect(before.length).toBeGreaterThan(0);
  await select(page, before[before.length - 1]);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await select(page, before[0]);
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(pay).toHaveText(before);
  await expect(live(page)).toHaveCount(0);
});
