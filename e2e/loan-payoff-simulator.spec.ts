import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { call } from "./support/register-seed";

// EXF-544: the Loan Payoff Simulator: Monthly Payment and a one-time extra, the Simulation series, the savings
// and Copy to plan. The clock is fixed at 2026-11-16 (as e2e/loan-page.spec.ts). The seeded mortgage is the
// ticket's observed loan: 199,500.00 at 6%, escrow 300.00, minimum 1,500.00 (357 payments, Aug 2056).
const CLOCK = "2026-11-16";
const NOV = "2026-11-01";
const fixClock = (page: Page) => page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("loan sim") });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        date: "2026-11-10",
        ...body,
      })
    ).account as { id: string; paired_category_id: string | null };
  await open({ name: "ZZ-TEST Checking", type: "checking", balance: 10000000 });
  const mortgage = await open({
    name: "ZZ-TEST Mortgage",
    type: "mortgage",
    balance: 199500000,
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
  return { plan, mortgage: mortgage.id, auto: auto.id, cat: mortgage.paired_category_id as string };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Loan Payoff Simulator" });
const payment = (page: Page) => dialog(page).getByRole("textbox", { name: "Monthly Payment" });
const extra = (page: Page) =>
  dialog(page).getByRole("textbox", { name: "One time extra in November" });
const figure = (page: Page, name: string) => dialog(page).getByRole("group", { name, exact: true });
const summary = (page: Page) => dialog(page).getByRole("region", { name: "Simulation summary" });
const copy = (page: Page) => dialog(page).getByRole("button", { name: "Copy and go to my plan" });
const reset = (page: Page) => dialog(page).getByRole("button", { name: "Reset all changes" });

async function openSim(page: Page, plan: string, id: string) {
  await fixClock(page);
  await page.goto(`/${plan}/accounts/${id}`);
  await expect(page.getByRole("group", { name: "Remaining Balance", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Payoff Simulator" }).click();
  await expect(dialog(page)).toBeVisible();
}

const catTarget = async (request: APIRequestContext, plan: string, cat: string) => {
  const m = await call(request, "GET", `/api/v1/budgets/${plan}/months/${NOV}`);
  return m.groups
    .flatMap((g: { categories: { id: string; target: unknown }[] }) => g.categories)
    .find((c: { id: string }) => c.id === cat).target;
};

test("AC1: opens prefilled with the minimum or the paired target, 357 payments and Aug 2056", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.mortgage);
  await expect(payment(page)).toHaveValue("1,500.00");
  await expect(
    dialog(page).getByText("You have 357 payments remaining on your loan."),
  ).toBeVisible();
  await expect(dialog(page).getByText("Aug 2056", { exact: true })).toBeVisible();
  await expect(dialog(page).getByText("$1,500.00 is your required minimum payment.")).toBeVisible();
  await expect(summary(page)).toContainText("Paying the minimum every month:");
  await expect(extra(page)).toBeVisible();

  await call(request, "PUT", `/api/v1/budgets/${s.plan}/categories/${s.cat}/target`, {
    type: "debt_payment",
    amount: 1800000,
    day: "last",
  });
  // The open dialog is flagged in the URL (?simulate=1) and survives a reload: close it first.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Open Payoff Simulator" }).click();
  await expect(payment(page)).toHaveValue("1,800.00");
  await expect(dialog(page).getByText("$1,800.00 is your current monthly target.")).toBeVisible();
  await expect(summary(page)).toContainText("Paying your target every month:");
});

test("AC2: a changed payment and a one-time extra show the Simulation, the savings and the new payoff", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.mortgage);
  await payment(page).fill("2000");
  await expect(dialog(page).getByText("Sep 2041", { exact: true })).toBeVisible();
  await expect(figure(page, "Time Savings")).toContainText("14 yrs, 11 mos");
  await expect(summary(page)).toContainText("Paying +$500.00 extra every month");
  await expect(dialog(page).getByText("Your original payoff date is Aug 2056")).toBeVisible();
  await expect(dialog(page).locator('path[data-series="simulation"]')).toHaveAttribute(
    "data-end-month",
    "2041-09-01",
  );
  await expect(figure(page, "Interest Savings")).toContainText("$126,886");

  await reset(page).click();
  await expect(dialog(page).locator('path[data-series="simulation"]')).toHaveCount(0);
  await extra(page).fill("10000");
  await expect(dialog(page).getByText("Dec 2052", { exact: true })).toBeVisible();
  await expect(figure(page, "Time Savings")).toContainText("3 yrs, 8 mos");
  await expect(summary(page)).toContainText("Paying +$10,000.00 extra this month");
  await expect(dialog(page).locator('path[data-series="simulation"]')).toHaveAttribute(
    "data-end-month",
    "2052-12-01",
  );
});

test("AC3: Reset restores the loan; Done writes nothing", async ({ page, request }) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.mortgage);
  await payment(page).fill("2000");
  await extra(page).fill("500");
  await expect(reset(page)).toBeVisible();
  await expect(copy(page)).toBeVisible();
  await reset(page).click();
  await expect(payment(page)).toHaveValue("1,500.00");
  await expect(extra(page)).toHaveValue("");
  await expect(
    dialog(page).getByText("You have 357 payments remaining on your loan."),
  ).toBeVisible();
  await expect(reset(page)).toHaveCount(0);
  await expect(copy(page)).toHaveCount(0);

  await payment(page).fill("2500");
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await catTarget(request, s.plan, s.cat)).toBeNull();
  await page.getByRole("button", { name: "Open Payoff Simulator" }).click();
  await expect(payment(page)).toHaveValue("1,500.00");
});

test("AC4: Copy and go to my plan sets the Debt Payment Target, and Undo removes it", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.mortgage);
  await payment(page).fill("2000");
  await copy(page).click();
  await expect(page).toHaveURL(new RegExp(`/${s.plan}/budget/202611$`));
  await expect(dialog(page)).toHaveCount(0);

  const t = await catTarget(request, s.plan, s.cat);
  expect(t.definition.amount).toBe(2000000);
  const sum = await call(
    request,
    "GET",
    `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}/summary?month=${NOV}`,
  );
  expect(sum.payment_source).toBe("target");
  expect(sum.payment_used).toBe(2000000);

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => catTarget(request, s.plan, s.cat)).toBeNull();
});

test("Base case: no change means no savings, no Copy, no Reset", async ({ page, request }) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.mortgage);
  await expect(figure(page, "Interest Savings")).toHaveCount(0);
  await expect(figure(page, "Time Savings")).toHaveCount(0);
  await expect(figure(page, "Time Remaining")).toContainText("29 yrs, 9 mos");
  await expect(copy(page)).toHaveCount(0);
  await payment(page).fill("1,500.00");
  await expect(figure(page, "Interest Savings")).toHaveCount(0);
  await expect(copy(page)).toHaveCount(0);
  await expect(reset(page)).toHaveCount(0);
  await expect(dialog(page).locator('path[data-series="simulation"]')).toHaveCount(0);
});

test("Unpaired loan: a change shows Reset but no Copy", async ({ page, request }) => {
  const s = await seed(request);
  await openSim(page, s.plan, s.auto);
  await payment(page).fill("500");
  await expect(reset(page)).toBeVisible();
  await expect(copy(page)).toHaveCount(0);
  await expect(figure(page, "Time Savings")).toBeVisible();
});
