import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

// EXF-482: loan accounts in Add Unlinked Account (AC1-AC5; the server ACs are in the worker tests).
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
const LOAN_TYPES = [
  "Mortgage",
  "Auto Loan",
  "Student Loan",
  "Personal Loan",
  "Medical Debt",
  "Other Debt",
];
const BALANCE_LABEL = "What is your current account balance?";
const HELP_PAYMENT =
  "Enter the total amount you are required to pay your lender each month, including principal, interest, escrow, fees, etc.";
const HELP_EXTRA = "You can add extra payments as a target in your plan later.";

async function openPlan(page: Page, request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("loans") },
  });
  const id = (await res.json()).data.budget.id as string;
  await page.goto(`/${id}/budget`);
  return { id, sidebar: page.getByRole("navigation", { name: "Sidebar" }) };
}
async function readyToAssign(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/v1/budgets/${id}/months/${MONTH}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data.ready_to_assign as number;
}
async function openLoanForm(page: Page, type: string) {
  await page.getByRole("button", { name: "Add Account" }).click();
  await page.getByRole("button", { name: "Add an Unlinked Account" }).click();
  await page.getByLabel("Give it a nickname").fill(`ZZ-TEST ${type}`);
  await page.getByRole("button", { name: "Select account type..." }).click();
  await page.getByRole("button", { name: type, exact: true }).click();
}
const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true });
async function fillLoan(page: Page, balance: string, rate: string, payment: string) {
  await page.getByLabel("Current account balance").fill(balance);
  await page.getByLabel("Interest rate").fill(rate);
  await page.getByLabel("Monthly payment required by your lender").fill(payment);
}

test("AC1: each loan type asks for balance, rate and payment", async ({ page, request }) => {
  await openPlan(page, request);
  for (const type of LOAN_TYPES) {
    await openLoanForm(page, type);
    await expect(page.getByLabel("Current account balance")).toBeVisible();
    await expect(page.getByLabel("Interest rate")).toBeVisible();
    await expect(page.getByLabel("Monthly payment required by your lender")).toBeVisible();
    await expect(page.locator(".loan-rate-suffix")).toHaveText("%");
    await expect(page.getByText(HELP_PAYMENT)).toBeVisible();
    await expect(page.getByText(HELP_EXTRA)).toBeVisible();
    await expect(page.getByLabel(BALANCE_LABEL)).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();
  }
});

test("AC2: Mortgage asks about escrow, No by default; Yes asks how much", async ({
  page,
  request,
}) => {
  await openPlan(page, request);
  await openLoanForm(page, "Mortgage");
  await expect(next(page)).toBeDisabled();
  await fillLoan(page, "180000", "6.5", "1400");
  await next(page).click();
  const question =
    "Are there escrow installments or other fees included in your mortgage payments?";
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByRole("radio", { name: "No" })).toBeChecked();
  await expect(page.getByText("How much is the monthly escrow or fee?")).toHaveCount(0);
  await page.getByRole("radio", { name: "Yes" }).check();
  await expect(page.getByText("How much is the monthly escrow or fee?")).toBeVisible();
});

test("AC3: Auto Loan goes straight to the optional pairing step", async ({ page, request }) => {
  await openPlan(page, request);
  await openLoanForm(page, "Auto Loan");
  await fillLoan(page, "25000", "5.25", "450");
  await next(page).click();
  await expect(page.getByRole("dialog", { name: "Optional: Pair a Category" })).toBeVisible();
  await expect(page.getByText("Are there escrow installments")).toHaveCount(0);
});

test("AC4: the pairing step's Next rule", async ({ page, request }) => {
  await openPlan(page, request);
  await openLoanForm(page, "Student Loan");
  await fillLoan(page, "9000", "4", "120");
  await next(page).click();
  const dialog = page.getByRole("dialog", { name: "Optional: Pair a Category" });
  await expect(dialog.getByRole("button", { name: "Skip" })).toBeEnabled();
  await expect(next(page)).toBeDisabled();
  await dialog.getByLabel("Select a category").selectOption({ index: 1 });
  await expect(next(page)).toBeEnabled();

  await dialog.getByRole("radio", { name: /Create a new category/ }).check();
  await expect(next(page)).toBeDisabled();
  const group = dialog.getByLabel("Add to category group");
  await expect(group.locator("option:not([hidden])").first()).toHaveText("New Category Group");
  await dialog.getByLabel("Give your category a name").fill("D3 Student");
  await expect(next(page)).toBeDisabled();
  await group.selectOption({ label: "New Category Group" });
  await expect(dialog.getByLabel("New category group name")).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await dialog.getByLabel("New category group name").fill("ZZ-TEST Loans");
  await expect(next(page)).toBeEnabled();
  await dialog.getByLabel("Give your category a name").fill("");
  await expect(next(page)).toBeDisabled();
});

test("AC5: a mortgage lands last in LOANS, negative, off-plan, Ready to Assign unchanged", async ({
  page,
  request,
}) => {
  const { id, sidebar } = await openPlan(page, request);
  const before = await readyToAssign(request, id);
  await openLoanForm(page, "Mortgage");
  await fillLoan(page, "180000", "6.5", "1400");
  await next(page).click();
  await next(page).click(); // escrow: No
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "Success!" })).toBeVisible();
  const last = sidebar.locator(".nav-account-row").last();
  await expect(last).toContainText("ZZ-TEST Mortgage");
  await expect(last).toContainText("−$180,000.00");
  expect(await readyToAssign(request, id)).toBe(before);
  await page.getByRole("button", { name: "Done" }).click();
  // The account's own register has no category column; All Accounts shows the Starting Balance row whole.
  await page.goto(`/${id}/accounts`);
  const row = page
    .locator(".register-table tbody tr[data-tx]")
    .filter({ hasText: "Starting Balance" });
  await expect(row.locator("td[data-field=outflow]")).toContainText("$180,000.00");
  await expect(row.locator("td[data-field=category]")).toHaveText("Category not needed");
  const list = await request.get(`/api/v1/budgets/${id}/accounts`, {
    headers: await authHeaders(),
  });
  const acc = (await list.json()).data.accounts[0];
  expect(acc.interest_rate).toBe("6.5");
  expect(acc.minimum_payment).toBe(1400000);
  expect(acc.escrow_amount).toBe(0);
});

test("a new category in a new group is paired through the UI", async ({ page, request }) => {
  const { id } = await openPlan(page, request);
  await openLoanForm(page, "Auto Loan");
  await fillLoan(page, "25000", "5.25", "450");
  await next(page).click();
  const dialog = page.getByRole("dialog", { name: "Optional: Pair a Category" });
  await dialog.getByRole("radio", { name: /Create a new category/ }).check();
  await dialog.getByLabel("Give your category a name").fill("D3 Car Payment");
  await dialog.getByLabel("Add to category group").selectOption({ label: "New Category Group" });
  await dialog.getByLabel("New category group name").fill("ZZ-TEST Loans");
  await next(page).click();
  await expect(page.getByRole("heading", { name: "Success!" })).toBeVisible();
  const headers = await authHeaders();
  const acc = (await (await request.get(`/api/v1/budgets/${id}/accounts`, { headers })).json()).data
    .accounts[0];
  const m = (await (await request.get(`/api/v1/budgets/${id}/months/${MONTH}`, { headers })).json())
    .data;
  const cat = m.groups
    .flatMap((g: { categories: { id: string; name: string }[] }) => g.categories)
    .find((c: { name: string }) => c.name === "D3 Car Payment");
  expect(cat).toBeTruthy();
  expect(acc.paired_category_id).toBe(cat.id);
});
