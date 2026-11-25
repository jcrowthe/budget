import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH, TODAY } from "./support/register-seed";

// EXF-543: the loan Update Balance wizard (fixture E of the spec): a 200,000.00 mortgage at 6.3%, escrow 300.00,
// a 1,500.00 payment today; the loan reads -$199,850.00 (6.3% of 200,000 / 12 = 1,050.00). The date is the real one.
const DIFFERENCE = 350000;

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan update"),
  });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        date: MONTH,
        ...body,
      })
    ).account.id as string;
  const checking = await open({ name: "ZZ-TEST Checking", type: "checking", balance: 50000000 });
  const mortgage = await open({
    name: "ZZ-TEST Mortgage",
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6.3",
    minimum_payment: 1500000,
    escrow_amount: 300000,
  });
  const paid = await call(
    request,
    "POST",
    `/api/v1/budgets/${plan}/accounts/${mortgage}/payments`,
    {
      from_account_id: checking,
      amount: 1500000,
      date: TODAY,
    },
  );
  return { plan, checking, mortgage, payment: paid.to_transaction.id as string };
}

const rta = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/months/${MONTH}`)).ready_to_assign as number;
const section = (page: Page, name: string) =>
  page.getByRole("region", { name }).or(page.getByRole("group", { name }));
const dialog = (page: Page) => page.getByRole("dialog", { name: "Update Balance" });
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const header = (page: Page) => page.locator(".acct-head");

async function openLoan(page: Page, s: { plan: string; mortgage: string }) {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$199,850.00");
}

test("AC1: Yes confirms the balance and freezes interest and escrow as Reconciled", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openLoan(page, s);
  await expect(header(page)).toContainText("Not Yet Updated");
  await expect(button(page, "Reconcile")).toHaveCount(0);
  await expect(section(page, "Interest Charges This Month")).toContainText("Estimated");

  await realClick(page, button(header(page), "Update Balance"));
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d).toContainText("Is your current balance at your lender −$199,850.00 ?");
  await realClick(page, button(d, "Yes"));
  await expect(d).toHaveCount(0);

  await expect(header(page)).toContainText("Updated a few seconds ago");
  await expect(section(page, "Interest Charges This Month")).toContainText("Reconciled");
  await expect(section(page, "Escrow Held")).toContainText("Reconciled");
  await expect(section(page, "Other Activity")).not.toContainText("Balance adjustment");
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$199,850.00");
});

test("AC2-AC5: No, the difference, the changes, the Done screen, the lines stay", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const rtaBefore = await rta(request, s.plan);
  await openLoan(page, s);

  await realClick(page, button(header(page), "Update Balance"));
  const d = dialog(page);
  await realClick(page, button(d, "No"));
  await expect(d).toContainText("Current balance in Budget");
  const lender = d.getByRole("textbox", { name: "Current balance at your financial institution" });
  await expect(button(d, "Next")).toBeDisabled();
  await lender.fill("199500");
  await realClick(page, button(d, "Next"));

  // AC2: the difference, the rate and the escrow.
  const tile = d.getByRole("group", { name: "Difference" });
  await expect(tile).toContainText("$350.00");
  await expect(tile).toContainText("Difference");
  await expect(d.getByRole("textbox", { name: "Interest rate" })).toHaveValue("6.3");
  await expect(
    d.getByRole("checkbox", { name: "Keep this new interest rate going forward" }),
  ).toBeChecked();
  await expect(d.getByRole("textbox", { name: "Monthly escrow amount" })).toHaveValue("300.00");
  await expect(
    d.getByRole("checkbox", { name: "Keep this new escrow amount going forward" }),
  ).toBeChecked();
  await realClick(page, button(d, "Next"));
  await expect(d).toContainText("Changes");
  await expect(d).toContainText("Balance Adjustment");
  await expect(d).toContainText("+$350.00");

  // AC3: the Done screen, then the page.
  await realClick(page, button(d, "Next"));
  await expect(d).toContainText(
    "Your balance has been updated! Time for the reconciliation dance.",
  );
  await expect(d).toContainText(
    "Remember to update your balance before making a payment to get the most accurate information.",
  );
  await realClick(page, button(d, "Done"));
  await expect(d).toHaveCount(0);
  await expect(header(page).locator('[data-balance="working"]')).toContainText("−$199,500.00");
  await expect(section(page, "Remaining Balance")).toContainText("$199,500.00");
  const other = section(page, "Other Activity");
  await expect(other).toContainText("Balance adjustment");
  await expect(other).toContainText("$350.00");
  await expect(other).toContainText("Entered automatically by Budget");
  await expect(section(page, "Interest Charges This Month")).toContainText("Reconciled");
  await expect(section(page, "Escrow Held")).toContainText("Reconciled");
  await expect(header(page)).toContainText("Updated a few seconds ago");

  // AC4: no category, and Ready to Assign did not move.
  const rows = (
    await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}/transactions`)
  ).transactions as { amount: number; category_id: string | null }[];
  const adjustment = rows.find((t) => t.amount === DIFFERENCE);
  expect(adjustment).toBeTruthy();
  expect(adjustment?.category_id).toBeNull();
  expect(await rta(request, s.plan)).toBe(rtaBefore);

  // Rule 8: deleting the payment keeps the frozen lines.
  const del = await request.fetch(`/api/v1/budgets/${s.plan}/transactions/${s.payment}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  expect(del.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(section(page, "Interest Charges This Month")).toContainText("Reconciled");
  await expect(section(page, "Escrow Held")).toContainText("Reconciled");
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$201,000.00");
});

test("a non-loan account still shows Reconcile and Not Yet Reconciled", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(header(page)).toContainText("Not Yet Reconciled");
  await expect(button(header(page), "Reconcile")).toBeVisible();
  await expect(button(header(page), "Update Balance")).toHaveCount(0);
});
