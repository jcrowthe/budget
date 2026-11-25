import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { panel, row } from "./plan-panel.fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";

// EXF-545: a loan's paired category in the Plan inspector: the header (Paired with, Available for Payment,
// Record Payment, Open Payoff Simulator), the Debt Payment Target and "$X paid this month". The clock is fixed
// at 2026-11-15; every row is made through the API. Ticket acceptance items 1 to 4.

const CLOCK = "2026-11-15";
const NOV = "2026-11-01";
const CAT = "ZZ-TEST Mortgage Pay";
const LOAN = "ZZ-TEST Mortgage";
const CHECKING = "ZZ-TEST Checking";

type Seed = { plan: string; checking: string; loan: string; cat: string };
let s: Seed;

async function seed(request: APIRequestContext): Promise<Seed> {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("paired") });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        date: "2026-11-02",
        ...body,
      })
    ).account as { id: string; paired_category_id: string | null };
  const checking = (await open({ name: CHECKING, type: "checking", balance: 5000000 })).id;
  const loan = await open({
    name: LOAN,
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    escrow_amount: 300000,
    new_category: { name: CAT, new_group_name: "ZZ-TEST Loans" },
  });
  return { plan, checking, loan: loan.id, cat: loan.paired_category_id as string };
}

test.beforeEach(async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));
  s = await seed(request);
});
test.afterEach(async ({ request }) => {
  if (s) await call(request, "DELETE", `/api/v1/budgets/${s.plan}`);
});

const select = async (page: Page) => {
  await page.goto(`/${s.plan}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await row(page, CAT).locator(".category-name").click();
  await expect(panel(page).getByRole("heading", { name: CAT, exact: true })).toBeVisible();
};
const loanCard = (page: Page) => panel(page).locator(".loan-paired");
const target = (page: Page) =>
  panel(page).locator(".panel-card", { has: page.locator("#panel-target") });
const form = (page: Page) => panel(page).locator(".target-form");
const rta = async (request: APIRequestContext) =>
  (await call(request, "GET", `/api/v1/budgets/${s.plan}/months/${NOV}?today=${CLOCK}`))
    .ready_to_assign as number;
const amount = (text: string | null) => Number((text ?? "").replace(/[^0-9.]/g, ""));

test("AC1: the paired category's header", async ({ page }) => {
  await select(page);
  const link = panel(page).getByRole("link", { name: LOAN });
  await expect(panel(page)).toContainText(`Paired with ${LOAN} Account`);
  await expect(link).toHaveAttribute("href", `/${s.plan}/accounts/${s.loan}`);
  await expect(loanCard(page)).toContainText("$0.00");
  await expect(loanCard(page)).toContainText("Available for Payment");
  await expect(loanCard(page).getByRole("button", { name: "Record Payment" })).toBeDisabled();
  await expect(loanCard(page).getByRole("button", { name: "Open Payoff Simulator" })).toBeVisible();
  await expect(loanCard(page)).toContainText("No payments recorded yet");
});

test("AC2 to AC4: create the target, meet it, record the payment", async ({ page, request }) => {
  await select(page);
  const rtaStart = await rta(request);
  // AC2
  await realClick(page, target(page).getByRole("button", { name: "Create Debt Payment Target" }));
  const f = form(page);
  await expect(panel(page).getByRole("heading", { name: "Debt Payment Target" })).toBeVisible();
  await expect(f.getByRole("textbox", { name: "Monthly Payment" })).toHaveValue("1,500.00");
  await expect(
    f.getByRole("combobox", { name: "Payoff Date" }).locator("option:checked"),
  ).toHaveText("Nov 2056");
  await expect(f).toContainText("30 years");
  const money = async (label: string) =>
    amount(
      await f
        .locator(".debt-summary-row", { hasText: label })
        .locator(".panel-row-value")
        .textContent(),
    );
  expect(await money("Minimum Payment")).toBe(1500);
  await expect(f.locator(".debt-summary-row", { hasText: "Time Remaining" })).toContainText(
    "30 years",
  );
  expect(await money("Principal")).toBe(200000);
  expect(Math.abs((await money("Interest (6%)")) - 231096.44)).toBeLessThanOrEqual(1);
  expect(Math.abs((await money("Remaining to Pay")) - 431096.44)).toBeLessThanOrEqual(1);
  // AC3
  await realClick(page, f.getByRole("button", { name: "Save Target" }));
  await expect(row(page, CAT)).toContainText("$1,500.00 needed by the 30th");
  const pill = row(page, CAT).locator(".available-pill");
  await expect(pill).toHaveClass(/cautious/);
  await expect(pill.locator("[data-icon=clock]")).toBeVisible();
  for (const t of [
    "Monthly Debt Payment",
    "$1,500.00",
    "Needed Each Month",
    "By the End of the Month",
  ]) {
    await expect(target(page)).toContainText(t);
  }
  await expect(target(page)).toContainText("Assign $1,500.00 to meet your target");
  await realClick(page, target(page).getByRole("button", { name: "Assign", exact: true }));
  await expect(target(page)).toContainText("You've met your target!");
  // AC4
  const record = loanCard(page).getByRole("button", { name: "Record Payment" });
  await expect(record).toBeEnabled();
  await realClick(page, record);
  const d = page.getByRole("dialog", { name: "Record Payment" });
  await expect(d.getByRole("textbox", { name: "Payment Amount" })).toHaveValue("1,500.00");
  await d.getByRole("combobox", { name: "From Account" }).selectOption({ label: CHECKING });
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(loanCard(page)).toContainText("$1,500.00 paid this month");
  await expect(panel(page)).toContainText("Cash Spending");
  await expect(panel(page).locator(".panel-row", { hasText: "Cash Spending" })).toContainText(
    "−$1,500.00",
  );
  await expect(row(page, CAT)).toContainText("Fully Spent");
  expect(await rta(request)).toBe(rtaStart - 1500000);
});

// EXF-544 follow-up: Open Payoff Simulator opens the simulator dialog itself, on the loan page, flagged in the
// URL (?simulate=1) so a reload keeps it open; closing it drops the flag.
test("Open Payoff Simulator opens the simulator dialog and survives a reload", async ({ page }) => {
  await select(page);
  await loanCard(page).getByRole("button", { name: "Open Payoff Simulator" }).click();
  const dialog = page.getByRole("dialog", { name: "Loan Payoff Simulator" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${s.plan}/accounts/${s.loan}\\?simulate=1$`));
  await expect(dialog.getByRole("textbox", { name: "Monthly Payment" })).toHaveValue("1,500.00");
  await page.reload();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${s.plan}/accounts/${s.loan}$`));
});
