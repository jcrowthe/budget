import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { call } from "./support/register-seed";

// EXF-540: a loan's page shows Account Activity (no register); Record Payment; the engine's lines.
// The clock is fixed at 2026-11-16, so "today" and the Starting Balance share a month.
const CLOCK = "2026-11-16";
const NOV = "2026-11-01";
const fixClock = (page: Page) => page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("loan") });
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
  const m = await call(request, "GET", `/api/v1/budgets/${plan}/months/${NOV}`);
  const cat = m.groups
    .flatMap((g: { categories: { id: string; name: string }[] }) => g.categories)
    .find((c: { name: string }) => c.name === "ZZ Mortgage Pay");
  await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${NOV}/categories/${cat.id}`, {
    assigned: 1500000,
  });
  return { plan, checking, mortgage, auto, cat: cat.id as string };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Record Payment" });
const section = (page: Page, name: string) =>
  page.getByRole("region", { name }).or(page.getByRole("group", { name }));

test("AC4: Record Payment from the mortgage page, then the month's lines (AC1) and the next month (AC3)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await fixClock(page);
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(page.locator(".register-table")).toHaveCount(0);
  await expect(page.getByText("No payments this month")).toBeVisible();

  await page.getByRole("button", { name: "Record Payment", exact: true }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(
    d.getByText("You have $1,500.00 available for payment in ZZ Mortgage Pay."),
  ).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Payment Amount" })).toHaveValue("1,500.00");
  await expect(d.getByRole("combobox", { name: "From Account" })).toHaveValue("");
  await expect(d.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await d
    .getByRole("combobox", { name: "From Account" })
    .selectOption({ label: "ZZ-TEST Checking" });
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);

  const cash = (
    await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.checking}/transactions`)
  ).transactions as { amount: number; category_id: string | null }[];
  expect(cash.find((t) => t.amount === -1500000)?.category_id).toBe(s.cat);

  // AC1: exactly four lines and the balance.
  await expect(page.getByText("November 2026")).toBeVisible();
  const payments = section(page, "Payments");
  await expect(payments.getByRole("listitem")).toHaveCount(1);
  await expect(payments).toContainText("$1,500.00");
  const interest = section(page, "Interest Charges This Month");
  await expect(interest).toContainText("Estimated");
  await expect(interest).toContainText("$1,000.00");
  await expect(section(page, "Escrow Held")).toContainText("Set aside by your lender");
  await expect(section(page, "Escrow Held")).toContainText("$300.00");
  const other = section(page, "Other Activity");
  await expect(other.getByRole("listitem")).toHaveCount(1);
  await expect(other).toContainText("-$200,000.00 Initial Balance on November 10");
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$199,800.00");

  // Reopening preselects the last source.
  await page.getByRole("button", { name: "Record Payment", exact: true }).click();
  await expect(dialog(page).getByRole("combobox", { name: "From Account" })).toHaveValue(
    s.checking,
  );
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();

  // AC3: the next month has no charges.
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText("December 2026")).toBeVisible();
  await expect(page.getByText("No payments this month")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interest Charges This Month" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Escrow Held" })).toHaveCount(0);
});

test("AC2: a short payment shows what is still due", async ({ page, request }) => {
  const s = await seed(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.auto}/payments`, {
    from_account_id: s.checking,
    amount: 50000,
    date: "2026-11-12",
  });
  await fixClock(page);
  await page.goto(`/${s.plan}/accounts/${s.auto}`);
  await expect(
    page.getByText("Estimated, $6.25 still due ($56.25 total this month)"),
  ).toBeVisible();
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$15,000.00");
});

test("a checking account still shows its register", async ({ page, request }) => {
  const s = await seed(request);
  await fixClock(page);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.locator(".register-table")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account Activity" })).toHaveCount(0);
});
