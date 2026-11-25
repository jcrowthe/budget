import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { call } from "./support/register-seed";

// EXF-541: a loan's page: tiles, payoff date, progress chart, paired category, simulator shell.
// The clock is fixed at 2026-11-16 (as e2e/loan-activity.spec.ts), so "this month" is November 2026.
const CLOCK = "2026-11-16";
const NOV = "2026-11-01";
const fixClock = (page: Page) => page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan page"),
  });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        date: "2026-11-10",
        ...body,
      })
    ).account.id as string;
  const checking = await open({ name: "ZZ-TEST Checking", type: "checking", balance: 10000000 });
  const mortgage = await open({
    name: "ZZ-TEST Mortgage",
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    escrow_amount: 300000,
    new_category: { name: "ZZ Mortgage Pay", new_group_name: "ZZ Loans" },
  });
  const auto = await open({
    name: "ZZ-TEST Auto",
    type: "autoLoan",
    balance: 15000000,
    interest_rate: "4.5",
    minimum_payment: 350000,
  });
  const medical = await open({
    name: "ZZ-TEST Medical",
    type: "medicalDebt",
    balance: 1000000,
    interest_rate: "0",
    minimum_payment: 100000,
  });
  const m = await call(request, "GET", `/api/v1/budgets/${plan}/months/${NOV}`);
  const cat = m.groups
    .flatMap((g: { categories: { id: string; name: string }[] }) => g.categories)
    .find((c: { name: string }) => c.name === "ZZ Mortgage Pay");
  await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${NOV}/categories/${cat.id}`, {
    assigned: 1500000,
  });
  return { plan, checking, mortgage, auto, medical, cat: cat.id as string };
}

const tile = (page: Page, label: string) => page.getByRole("group", { name: label, exact: true });
const open = async (page: Page, plan: string, id: string) => {
  await fixClock(page);
  await page.goto(`/${plan}/accounts/${id}`);
  await expect(tile(page, "Remaining Balance")).toBeVisible();
};
const sentence = (page: Page) => page.getByTestId("loan-track-sentence");

test("AC1: the tiles; Escrow only for a mortgage", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s.plan, s.mortgage);
  await expect(tile(page, "Remaining Balance")).toContainText("$200,000.00");
  await expect(tile(page, "Interest Rate")).toContainText("6%");
  await expect(tile(page, "Minimum Payment")).toContainText("$1,500.00");
  await expect(tile(page, "Escrow")).toContainText("$300.00");
  await expect(tile(page, "Payoff Date")).toContainText("Nov 2056");
  await expect(page.getByText("Balance Remaining $200,000 (100.0%)")).toBeVisible();

  await open(page, s.plan, s.auto);
  await expect(tile(page, "Interest Rate")).toContainText("4.5%");
  await expect(tile(page, "Minimum Payment")).toContainText("$350.00");
  await expect(tile(page, "Escrow")).toHaveCount(0);

  await open(page, s.plan, s.medical);
  await expect(tile(page, "Interest Rate")).toContainText("0%");
  await expect(tile(page, "Escrow")).toHaveCount(0);
});

test("AC2: the five payoff cases and their duration texts", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s.plan, s.mortgage);
  await expect(tile(page, "Payoff Date")).toContainText("Nov 2056");
  await expect(sentence(page)).toHaveText(
    "The minimum payment of $1,500.00 will pay off this loan in 30 years",
  );

  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}/payments`, {
    from_account_id: s.checking,
    amount: 1500000,
    date: CLOCK,
  });
  await page.reload();
  await expect(tile(page, "Remaining Balance")).toContainText("$199,800.00");
  await expect(tile(page, "Payoff Date")).toContainText("Oct 2056");
  await expect(sentence(page)).toContainText("29 yrs, 11 mos");

  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}/adjust-balance`, {
    balance: -199500000,
  });
  await page.reload();
  await expect(tile(page, "Remaining Balance")).toContainText("$199,500.00");
  await expect(tile(page, "Payoff Date")).toContainText("Aug 2056");
  await expect(sentence(page)).toContainText("29 yrs, 9 mos");

  await open(page, s.plan, s.auto);
  await expect(tile(page, "Payoff Date")).toContainText("Oct 2030");
  await expect(sentence(page)).toContainText("3 yrs, 11 mos");

  await open(page, s.plan, s.medical);
  await expect(tile(page, "Payoff Date")).toContainText("Sep 2027");
  await expect(sentence(page)).toContainText("10 months");
});

test("AC3: the paired panel with and without a target; Get Started pairs", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await open(page, s.plan, s.mortgage);
  const panel = page.getByRole("region", { name: "Paired Plan Category" });
  await expect(panel.getByRole("link", { name: "ZZ Loans: ZZ Mortgage Pay" })).toBeVisible();
  await expect(panel.getByTestId("loan-available")).toHaveText("$1,500.00");
  await expect(panel.getByRole("link", { name: "(+) Create Debt Payment Target" })).toBeVisible();
  // The link opens the plan with the paired category selected: its Target card offers the editor (EXF-545).
  await panel.getByRole("link", { name: "(+) Create Debt Payment Target" }).click();
  await expect(page.getByRole("button", { name: "Create Debt Payment Target" })).toBeVisible();
  await page.goBack();
  await expect(panel).toBeVisible();

  await call(request, "PUT", `/api/v1/budgets/${s.plan}/categories/${s.cat}/target`, {
    cadence: "monthly",
    behavior: "set_aside",
    amount: 1600000,
  });
  await page.reload();
  await expect(panel.getByText("$1,600.00")).toBeVisible();
  await expect(panel.getByText("Monthly Debt Payment")).toBeVisible();
  await expect(panel.getByText("by the End of the Month")).toBeVisible();
  await expect(panel.getByRole("link", { name: "(+) Create Debt Payment Target" })).toHaveCount(0);
  await expect(sentence(page)).toContainText("Your monthly target of $1,600.00 keeps you on track");

  await open(page, s.plan, s.auto);
  await expect(panel.getByText("Pair your loan and get more out of your plan")).toBeVisible();
  await panel.getByRole("button", { name: "Get Started" }).click();
  const d = page.getByRole("dialog", { name: "Pair a Category" });
  await expect(d.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await d
    .getByRole("combobox", { name: "Select a category" })
    .selectOption({ label: "ZZ Mortgage Pay" });
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "ZZ Loans: ZZ Mortgage Pay" })).toBeVisible();
});

test("AC4: the current track runs from today's balance to 0 at the payoff month", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await open(page, s.plan, s.mortgage);
  const track = page.locator('path[data-series="current"]');
  await expect(track).toHaveAttribute("data-start-month", NOV);
  await expect(track).toHaveAttribute("data-start-balance", "200000000");
  await expect(track).toHaveAttribute("data-end-month", "2056-11-01");
  await expect(track).toHaveAttribute("data-end-balance", "0");
  await expect(track).toHaveAttribute("stroke-dasharray", /\d/);
  await expect(page.locator('path[data-series="past"]')).toHaveCount(1);
  await expect(page.locator('path[data-series="original"]')).toHaveCount(1);
  const legend = page.locator(".loan-legend");
  await expect(legend).toContainText("Past Balance");
  await expect(legend).toContainText("Original Payment Schedule");
  await expect(legend).toContainText("Current Track");
  await legend.getByRole("button", { name: "About Current Track" }).hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "if you pay the minimum required amount" }),
  ).toBeVisible();
  const toggle = page.getByRole("button", { name: "Your Loan's Progress" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(track).toHaveCount(0);
});

test("AC5: Open Payoff Simulator and Try It Now open the simulator; Done closes it", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await open(page, s.plan, s.mortgage);
  const d = page.getByRole("dialog", { name: "Loan Payoff Simulator" });
  await page.getByRole("button", { name: "Open Payoff Simulator" }).click();
  await expect(d).toBeVisible();
  await expect(d.getByText("You have 360 payments remaining on your loan.")).toBeVisible();
  await expect(d.getByText("Nov 2056")).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "Try It Now" }).click();
  await expect(d).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("button", { name: "Try It Now" })).toHaveCount(0);
});
