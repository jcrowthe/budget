import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  assign,
  box,
  GROCERIES,
  longMonth,
  NEXT,
  openPlan,
  panel,
  RENT,
  removePlan,
  type Seed,
  seedPlan,
  TODAY,
} from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { monthIso } from "./support/plan-seed";
import { realClick } from "./support/real-click";

let s: Seed;
test.beforeEach(async ({ request }) => {
  s = await seedPlan(request, "future");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const card = (page: Page) =>
  panel(page).locator(".panel-card", {
    has: page.getByRole("heading", { name: "Assigned in Future Months" }),
  });
const header = (page: Page) => card(page).locator(".card-roll-up");
const rows = (page: Page) => card(page).locator(".future-month");
const total = (page: Page) => header(page).locator(".card-roll-up-right");
const money = (t: string) => Number(t.replace(/[^0-9.-]/g, "").replace("−", "-"));
const name = (offset: number) => longMonth(monthIso(offset));
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("with nothing assigned ahead, the next month shows at $0.00", async ({ page }) => {
  await openPlan(page, s);
  await expect(total(page)).toHaveText("$0.00");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveText(`${longMonth(NEXT)}$0.00`);
});

test("AC1: the total follows assigned money in later months", async ({ page, request }) => {
  await assign(request, s, GROCERIES, 130000, NEXT);
  await openPlan(page, s);
  await expect(total(page)).toHaveText("$130.00");
  await expect(rows(page)).toHaveText([`${name(1)}$130.00`]);
  const next = page.getByRole("button", { name: "Next month", exact: true });
  await realClick(page, next);
  await realClick(page, next);
  const done = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/months\/.+\/categories\//.test(r.url()),
  );
  await page
    .locator(".category-row", { has: page.getByText(RENT, { exact: true }) })
    .locator(".assigned-box .amount")
    .click();
  await page.keyboard.type("7.00");
  await page.getByRole("textbox", { name: `Assigned for ${RENT}` }).press("Enter");
  await done;
  // Editing the amount selects the row, which hides the card: clear the selection.
  await page.keyboard.press("Escape");
  const prev = page.getByRole("button", { name: "Previous month", exact: true });
  await realClick(page, prev);
  await realClick(page, prev);
  await expect(rows(page)).toHaveText([`${name(1)}$130.00`, `${name(2)}$7.00`]);
  await expect(total(page)).toHaveText("$137.00");
});

test("AC2: a row per month in date order, summing to the total and the API", async ({
  page,
  request,
}) => {
  await assign(request, s, GROCERIES, 100000, NEXT);
  await assign(request, s, RENT, 30000, NEXT);
  await assign(request, s, GROCERIES, 7000, monthIso(3));
  await openPlan(page, s);
  await expect(rows(page)).toHaveText([`${name(1)}$130.00`, `${name(2)}$0.00`, `${name(3)}$7.00`]);
  await expect(total(page)).toHaveText("$137.00");
  const values = await rows(page).locator(".future-month-value").allTextContents();
  expect(values.map(money).reduce((a, b) => a + b, 0)).toBe(
    money((await total(page).textContent()) ?? ""),
  );
  const res = await request.get(
    `/api/v1/budgets/${s.id}/months/${TODAY}/summary?today=${localDay()}`,
    {
      headers: await authHeaders(),
    },
  );
  const body = (await res.json()).data;
  expect(body.future_assigned).toEqual([
    { month: NEXT, assigned: 130000 },
    { month: monthIso(2), assigned: 0 },
    { month: monthIso(3), assigned: 7000 },
  ]);
  expect(body.future_assigned_total).toBe(137000);
});

test("AC3: a row opens its month, where the card is gone", async ({ page, request }) => {
  await assign(request, s, GROCERIES, 7000, monthIso(3));
  await openPlan(page, s);
  await realClick(page, rows(page).nth(2));
  const target = monthIso(3);
  await expect(page).toHaveURL(new RegExp(`/budget/${target.slice(0, 7).replace("-", "")}$`));
  await expect(page.getByText(`${name(3)}`, { exact: false }).first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("AC4: hidden on another month and with a category selected", async ({ page }) => {
  await openPlan(page, s, NEXT);
  await expect(panel(page).getByRole("heading", { name: /Summary/ })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await openPlan(page, s);
  await expect(card(page)).toHaveCount(1);
  await page.locator(".category-name", { hasText: GROCERIES }).click();
  await expect(box(page, GROCERIES)).toBeChecked();
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(1);
});

test("AC5: the header collapses and expands the rows", async ({ page }) => {
  await openPlan(page, s);
  await expect(header(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rows(page).first()).toBeVisible();
  await header(page).click();
  await expect(header(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rows(page).first()).toBeHidden();
  await header(page).click();
  await expect(header(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rows(page).first()).toBeVisible();
});

test("it is the last card, and a month 12 ahead is named with its year", async ({
  page,
  request,
}) => {
  await assign(request, s, GROCERIES, 1000, monthIso(13));
  await openPlan(page, s);
  const heads = await panel(page).locator(".panel-card-title").allTextContents();
  expect(heads.slice(-2)).toEqual(["Auto-Assign", "Assigned in Future Months"]);
  await expect(rows(page)).toHaveCount(13);
  const year = monthIso(12).slice(0, 4);
  await expect(rows(page).nth(11).locator(".future-month-label")).toHaveText(`${name(12)} ${year}`);
  await expect(rows(page).nth(10).locator(".future-month-label")).toHaveText(name(11));
});
