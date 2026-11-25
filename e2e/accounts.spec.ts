import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

async function newPlan(request: APIRequestContext) {
  const name = testName("accounts");
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  return { id: (await res.json()).data.budget.id as string, name };
}
async function readyToAssign(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/v1/budgets/${id}/months/${MONTH}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data.ready_to_assign as number;
}
async function openPlan(page: Page, request: APIRequestContext) {
  const plan = await newPlan(request);
  await page.goto(`/${plan.id}/budget`);
  return { ...plan, sidebar: page.getByRole("navigation", { name: "Sidebar" }) };
}
async function openForm(page: Page) {
  await page.getByRole("button", { name: "Add Account" }).click();
  await page.getByRole("button", { name: "Add an Unlinked Account" }).click();
}
async function fill(page: Page, name: string, type: string, balance: string) {
  await page.getByLabel("Give it a nickname").fill(name);
  await page.getByRole("button", { name: "Select account type..." }).click();
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.getByLabel("What is your current account balance?").fill(balance);
}
async function add(page: Page, name: string, type: string, balance: string) {
  await openForm(page);
  await fill(page, name, type, balance);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Success!" })).toBeVisible();
}

test("form, Next rule and picker", async ({ page, request }) => {
  await openPlan(page, request);
  await openForm(page);
  const dialog = page.getByRole("dialog", { name: "Add Unlinked Account" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Let's go!")).toBeVisible();
  await expect(dialog.getByText("What type of account are you adding?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Select account type..." })).toBeVisible();
  await expect(page.getByLabel("Give it a nickname")).toBeFocused();
  const next = page.getByRole("button", { name: "Next", exact: true });
  await expect(next).toBeDisabled();

  await page.getByLabel("Give it a nickname").fill("   ");
  await page.getByLabel("What is your current account balance?").fill("5");
  await page.getByRole("button", { name: "Select account type..." }).click();
  await expect(page.getByRole("dialog", { name: "Select Account Type" })).toBeVisible();
  const headings = page.getByRole("heading", { level: 3 });
  await expect(headings).toHaveText([
    "Cash Accounts",
    "Credit Accounts",
    "Mortgages and Loans",
    "Tracking Accounts",
  ]);
  await expect(page.locator(".type-tile")).toHaveText([
    "Checking",
    "Savings",
    "Cash",
    "Credit Card",
    "Line of Credit",
    "Mortgage",
    "Auto Loan",
    "Student Loan",
    "Personal Loan",
    "Medical Debt",
    "Other Debt",
    "Asset (e.g. Investment)",
    "Liability",
  ]);
  await expect(page.getByRole("button", { name: "Mortgage", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Savings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Savings", exact: true })).toBeVisible();
  await expect(page.getByLabel("What is your current account balance?")).toHaveValue("5");
  await expect(next).toBeDisabled(); // blank nickname
  await page.getByLabel("Give it a nickname").fill("X");
  await expect(next).toBeEnabled();
  await page.getByLabel("What is your current account balance?").fill("");
  await expect(next).toBeDisabled();
  await page.getByLabel("What is your current account balance?").fill("abc");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText("Enter an amount")).toBeVisible();
  await page.getByLabel("What is your current account balance?").fill("10+5");
  await next.click();
  await expect(page.getByText("Enter an amount")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Add Accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("checking, credit, asset, liability, zero", async ({ page, request }) => {
  const { id, name: planName, sidebar } = await openPlan(page, request);
  const before = await readyToAssign(request, id);
  await add(page, "ZZ-TEST Second", "Cash", "1");
  await page.getByRole("button", { name: "Done" }).click();
  await add(page, "ZZ-TEST D3 Checking", "Checking", "250");
  await expect(page.getByText("Add transactions in the register")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/${id}/accounts/[0-9a-f-]{36}$`));
  await expect(page).toHaveTitle(`ZZ-TEST D3 Checking | ${planName} | Budget`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ZZ-TEST D3 Checking");
  await expect(page.getByText("Checking", { exact: true })).toBeVisible();
  await expect(page.locator(".acct-balances")).toContainText("$250.00");
  await expect(sidebar.getByText("CASH", { exact: true })).toBeVisible();
  await expect(sidebar.locator(".nav-account-row .name")).toHaveText([
    "ZZ-TEST Second",
    "ZZ-TEST D3 Checking",
  ]);
  await expect(sidebar.locator(".nav-account-row").last()).toContainText("$250.00");
  expect(await readyToAssign(request, id)).toBe(before + 251000);

  await add(page, "ZZ-TEST Card", "Credit Card", "150");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(sidebar.getByText("CREDIT", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /ZZ-TEST Card/ })).toContainText("−$150.00");
  await add(page, "ZZ-TEST Asset", "Asset (e.g. Investment)", "5000");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Tracking Account: Asset")).toBeVisible();
  await add(page, "ZZ-TEST Liab", "Liability", "700");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Tracking Account: Liability")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /ZZ-TEST Liab/ })).toContainText("−$700.00");
  expect(await readyToAssign(request, id)).toBe(before + 251000);

  await add(page, "ZZ-TEST Zero", "Savings", "0");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".acct-balances")).toContainText("$0.00");
});

test("duplicate name, Add Another, history", async ({ page, request }) => {
  const { id } = await openPlan(page, request);
  const entries = await page.evaluate(() => history.length);
  await add(page, "ZZ-TEST Dup X", "Savings", "5");
  await page.getByRole("button", { name: "Add Another" }).click();
  await expect(page.getByRole("dialog", { name: "Add Accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Add an Unlinked Account" }).click();
  await expect(page.getByLabel("Give it a nickname")).toHaveValue("");
  await fill(page, "  zz-test dup x ", "Checking", "1");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("This account name already exists.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add Unlinked Account" })).toBeVisible();
  const res = await request.get(`/api/v1/budgets/${id}/accounts`, { headers: await authHeaders() });
  expect((await res.json()).data.accounts).toHaveLength(1);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(`/${id}/budget`);
  expect(await page.evaluate(() => history.length)).toBe(entries);

  await add(page, "ZZ-TEST Via X", "Checking", "2");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(new RegExp(`/${id}/accounts/[0-9a-f-]{36}$`));
});
