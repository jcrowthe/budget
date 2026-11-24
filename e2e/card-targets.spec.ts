import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { panel, row } from "./plan-panel.fixtures";
import { CARD, CLOCK, seedCardTarget } from "./support/card-target-seed";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";

// EXF-538: targets on a credit card payment category, in the Plan page's inspector and grid. The clock is fixed
// at 2026-11-16 and every row is made through the API. Ticket acceptance items 1 to 4.

type Seed = Awaited<ReturnType<typeof seedCardTarget>>;
let s: Seed;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));
});
test.afterEach(async ({ request }) => {
  if (s) await call(request, "DELETE", `/api/v1/budgets/${s.plan}`);
});

const open = async (page: Page, month = "202611") => {
  await page.goto(`/${s.plan}/budget/${month}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(row(page, CARD)).toBeVisible();
};
const select = async (page: Page) => {
  await open(page);
  await row(page, CARD).locator(".category-name").click();
  await expect(panel(page).getByRole("heading", { name: CARD, exact: true })).toBeVisible();
};
const target = (page: Page) =>
  panel(page).locator(".panel-card", { has: page.locator("#panel-target") });
const form = (page: Page) => panel(page).locator(".target-form");
const pill = (page: Page) => row(page, CARD).locator(".available-pill");
const storedTarget = async (request: Parameters<typeof call>[0]) =>
  (await call(request, "GET", `/api/v1/budgets/${s.plan}/months/2026-11-01?today=${CLOCK}`)).groups
    .flatMap((g: { categories: { id: string; target: unknown }[] }) => g.categories)
    .find((c: { id: string }) => c.id === s.pay).target;

test("1 and 2: create Pay Specific Amount Monthly from the Payment card", async ({
  page,
  request,
}) => {
  s = await seedCardTarget(request);
  await select(page);
  const payment = panel(page).locator("section.payment-card");
  await expect(payment).toContainText("Underfunded");
  await realClick(page, payment.getByRole("button", { name: "Create a Debt Payoff Target" }));
  await expect(form(page)).toBeVisible();
  const kinds = form(page).getByRole("combobox", { name: "Target" });
  await expect(kinds.locator("option")).toHaveText([
    "Pay Off Balance by Date",
    "Pay Specific Amount Monthly",
  ]);
  await kinds.selectOption({ label: "Pay Specific Amount Monthly" });
  const amount = form(page).getByRole("textbox", { name: "Target Amount" });
  await amount.fill("100");
  await amount.press("Tab");
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await expect(target(page)).toContainText("Pay Specific Amount Monthly");
  await expect(target(page)).toContainText("$100.00");
  await expect(target(page)).toContainText("Each Month");
  await expect(target(page)).toContainText("0%");
  await expect(target(page)).toContainText("Assign $100.00 to meet your target");
  await expect(target(page)).toContainText("Amount to Assign This Month");
  await expect(target(page)).toContainText("Assigned So Far");
  await expect(target(page)).toContainText("To Go");
  await expect(pill(page)).toHaveClass(/cautious/);
  await expect(pill(page).locator("[data-icon=target]")).toBeVisible();
  await realClick(page, target(page).getByRole("button", { name: "Assign", exact: true }));
  await expect(target(page)).toContainText("You've met your target!");
  await expect(pill(page).locator("[data-icon=check]")).toBeVisible();
  expect(await storedTarget(request)).toMatchObject({ status: "funded", funded: 100000 });
  await open(page, "202612");
  await row(page, CARD).locator(".category-name").click();
  await expect(target(page)).toContainText("Assign $100.00 to meet your target");
});

test("3: the payoff example shows its figures; the form defaults to next month", async ({
  page,
  request,
}) => {
  s = await seedCardTarget(request, { example: true });
  expect((await s.putTarget({ type: "card_payoff_by_date", month: "2027-02-01" })).status()).toBe(
    200,
  );
  await select(page);
  const t = target(page);
  await expect(t).toContainText("Pay off $1,200.00");
  await expect(t).toContainText("By Feb 2027");
  await expect(t).toContainText("Assign $200.00 more this month to stay on track");
  await expect(t).toContainText("Needed for Payoff");
  await expect(t).toContainText("$1,112.00");
  await expect(t).toContainText("Available for Payment");
  await expect(t).toContainText("$12.00");
  await expect(t).toContainText("To Go");
  await expect(t).toContainText("$1,100.00");
  await expect(t).toContainText("8%");
});

test("create on a fresh card defaults the payoff month to December 2026", async ({
  page,
  request,
}) => {
  s = await seedCardTarget(request);
  await select(page);
  await realClick(page, panel(page).getByRole("button", { name: "Create a Debt Payoff Target" }));
  await expect(form(page).getByRole("combobox", { name: "Target" })).toHaveValue(
    "card_payoff_by_date",
  );
  await expect(form(page).getByRole("combobox", { name: "Select Month" })).toHaveValue("11");
  await expect(form(page).getByRole("combobox", { name: "Select Year" })).toHaveValue("2026");
});

test("4: Cancel, an outside press and Delete", async ({ page, request }) => {
  s = await seedCardTarget(request);
  expect((await s.putTarget({ type: "card_monthly", amount: 100000 })).status()).toBe(200);
  await select(page);
  const edit = () => realClick(page, target(page).getByRole("button", { name: "Edit Target" }));
  await edit();
  const amount = form(page).getByRole("textbox", { name: "Target Amount" });
  await amount.fill("250");
  await amount.press("Tab");
  await realClick(page, form(page).getByRole("button", { name: "Cancel" }));
  await expect(form(page)).toHaveCount(0);
  await expect(target(page)).toContainText("$100.00");
  // an outside press closes the editor and sends nothing
  await edit();
  await form(page).getByRole("textbox", { name: "Target Amount" }).fill("300");
  const puts: string[] = [];
  page.on("request", (r) => r.method() === "PUT" && puts.push(r.url()));
  await realClick(page, page.locator(".grid-header, [role=columnheader]").first());
  await expect(form(page)).toHaveCount(0);
  await expect(target(page)).toContainText("$100.00");
  expect(puts).toEqual([]);
  // Delete brings the Payment card and the payment pill back
  await edit();
  await realClick(page, form(page).getByRole("button", { name: "Delete" }));
  await expect(panel(page).locator("section.payment-card")).toContainText("Underfunded");
  await expect(
    panel(page).getByRole("button", { name: "Create a Debt Payoff Target" }),
  ).toBeVisible();
  await expect(pill(page).locator("[data-icon=target]")).toHaveCount(0);
  expect(await storedTarget(request)).toBeNull();
});
