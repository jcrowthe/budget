import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH, TODAY } from "./support/register-seed";

// Loan manage: Edit or delete a recorded interest, fee or credit line; unpair a loan or pair it with a new
// category (docs/loan-manage-design.md). A 200,000.00 mortgage at 6%, escrow 300.00, a 1,500.00 payment today:
// interest -$1,000.00 (Estimated), balance -$199,800.00. The date is the real one.
const dayLabel = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const LOCK = "Reconciled, not editable";

async function seed(request: APIRequestContext, paired = false) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan manage"),
  });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, { date: MONTH, ...body }))
      .account.id as string;
  const checking = await open({ name: "ZZ-TEST Checking", type: "checking", balance: 50000000 });
  const mortgage = await open({
    name: "ZZ-TEST Mortgage",
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    escrow_amount: 300000,
    ...(paired
      ? { new_category: { name: "ZZ-TEST Mortgage Pay", new_group_name: "ZZ-TEST Loans" } }
      : {}),
  });
  await call(request, "POST", `/api/v1/budgets/${plan}/accounts/${mortgage}/payments`, {
    from_account_id: checking,
    amount: 1500000,
    date: TODAY,
  });
  const api = (path: string, body: unknown, method = "POST") =>
    call(request, method, `/api/v1/budgets/${plan}/accounts/${mortgage}/${path}`, body);
  const interest = (amount: number) =>
    api("activity", { kind: "interest", amount, month: MONTH, today: TODAY });
  const fee = (amount: number) =>
    api("activity", { kind: "fee", amount, date: TODAY, memo: "ZZ-TEST late fee", today: TODAY });
  return { plan, checking, mortgage, api, interest, fee };
}
type Seed = Awaited<ReturnType<typeof seed>>;

const section = (page: Page, name: string) =>
  page.getByRole("region", { name }).or(page.getByRole("group", { name }));
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const ending = (page: Page) => page.getByTestId("loan-ending-balance");
const interestSection = (page: Page) => section(page, "Interest Charges This Month");
const panel = (page: Page) => page.getByRole("region", { name: "Paired Plan Category" });

async function openLoan(page: Page, s: Seed, balance = "−$199,800.00") {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(ending(page)).toHaveText(balance);
}

test("edit an interest line: the new amount, Edited on, and the balance", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await s.interest(50000);
  await openLoan(page, s, "−$199,850.00");
  await expect(interestSection(page)).toContainText("−$1,050.00");
  await realClick(page, button(interestSection(page), "Edit interest"));
  const d = dialog(page, "Edit Interest");
  await expect(d.getByLabel("Amount")).toHaveValue("1,050.00");
  await d.getByLabel("Amount").fill("1075");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(interestSection(page)).toContainText("−$1,075.00");
  await expect(interestSection(page)).toContainText(`Edited on ${dayLabel}`);
  await expect(ending(page)).toHaveText("−$199,875.00");
});

test("delete an interest line: it reads Estimated again", async ({ page, request }) => {
  const s = await seed(request);
  await s.interest(50000);
  await openLoan(page, s, "−$199,850.00");
  await realClick(page, button(interestSection(page), "Edit interest"));
  const d = dialog(page, "Edit Interest");
  await realClick(page, button(d, "Delete"));
  const confirm = page.getByRole("alertdialog", { name: "Delete this line?" });
  await expect(confirm).toBeVisible();
  await realClick(page, button(confirm, "Delete"));
  await expect(confirm).toHaveCount(0);
  await expect(interestSection(page)).toContainText("Estimated");
  await expect(ending(page)).toHaveText("−$199,800.00");
});

test("edit and delete a fee", async ({ page, request }) => {
  const s = await seed(request);
  await s.fee(25000);
  await openLoan(page, s, "−$199,825.00");
  const other = section(page, "Other Activity");
  await expect(other).toContainText(`Fee or Charge on ${dayLabel}: ZZ-TEST late fee`);
  await realClick(page, button(other, `Edit Fee or Charge on ${dayLabel}`));
  const d = dialog(page, "Edit Fee or Charge");
  await d.getByLabel("Amount").fill("40");
  await d.getByLabel("Memo").fill("ZZ-TEST edited fee");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(other).toContainText(`Fee or Charge on ${dayLabel}: ZZ-TEST edited fee`);
  await expect(other).toContainText("−$40.00");
  await expect(ending(page)).toHaveText("−$199,840.00");
  await realClick(page, button(other, `Edit Fee or Charge on ${dayLabel}`));
  await realClick(page, button(dialog(page, "Edit Fee or Charge"), "Delete"));
  await realClick(
    page,
    button(page.getByRole("alertdialog", { name: "Delete this line?" }), "Delete"),
  );
  await expect(other).not.toContainText("Fee or Charge");
  await expect(ending(page)).toHaveText("−$199,800.00");
});

test("a reconciled line shows the lock and has no Edit button", async ({ page, request }) => {
  const s = await seed(request);
  // 1,000.00 more than the estimate: Update Balance freezes the lines and adds a Balance adjustment row.
  await s.api("balance-update", { balance: -199700000, today: TODAY });
  await openLoan(page, s, "−$199,700.00");
  const interest = interestSection(page);
  await expect(interest).toContainText("Reconciled");
  await expect(interest.getByRole("img", { name: LOCK })).toBeVisible();
  await expect(interest.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  const other = section(page, "Other Activity");
  await expect(other).toContainText("Balance adjustment");
  await expect(other.getByRole("img", { name: LOCK })).toHaveCount(1);
  await expect(other.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
});

test("Get Started: create a new category in a new group", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  await expect(panel(page).getByText("Pair your loan and get more out of your plan")).toBeVisible();
  await button(panel(page), "Get Started").click();
  const d = dialog(page, "Pair a Category");
  await expect(button(d, "Save")).toBeDisabled();
  await d.getByRole("radio", { name: /Create a new category/ }).check();
  await d.getByLabel("Give your category a name").fill("ZZ-TEST Mortgage Pay");
  await d.getByLabel("Add to category group").selectOption({ label: "New Category Group" });
  await d.getByLabel("New category group name").fill("ZZ-TEST Loans");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(
    panel(page).getByRole("link", { name: "ZZ-TEST Loans: ZZ-TEST Mortgage Pay" }),
  ).toBeVisible();
  const month = await call(request, "GET", `/api/v1/budgets/${s.plan}/months/${MONTH}`);
  const group = month.groups.find((g: { name: string }) => g.name === "ZZ-TEST Loans");
  expect(group.categories.map((c: { name: string }) => c.name)).toEqual(["ZZ-TEST Mortgage Pay"]);
  const account = await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}`);
  expect(account.account.paired_category_id).toBe(group.categories[0].id);
});

test("Unpair: confirm, and the panel shows Get Started", async ({ page, request }) => {
  const s = await seed(request, true);
  await openLoan(page, s);
  await expect(
    panel(page).getByRole("link", { name: "ZZ-TEST Loans: ZZ-TEST Mortgage Pay" }),
  ).toBeVisible();
  await realClick(page, button(panel(page), "Unpair"));
  const confirm = page.getByRole("alertdialog", { name: "Unpair this loan?" });
  await expect(confirm).toContainText("The category stays in your plan with its money and target.");
  await realClick(page, button(confirm, "Cancel"));
  await expect(confirm).toHaveCount(0);
  await expect(button(panel(page), "Unpair")).toBeVisible();
  await realClick(page, button(panel(page), "Unpair"));
  await realClick(
    page,
    button(page.getByRole("alertdialog", { name: "Unpair this loan?" }), "Unpair"),
  );
  await expect(button(panel(page), "Get Started")).toBeVisible();
  const account = await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}`);
  expect(account.account.paired_category_id).toBeNull();
  const month = await call(request, "GET", `/api/v1/budgets/${s.plan}/months/${MONTH}`);
  expect(JSON.stringify(month.groups)).toContain("ZZ-TEST Mortgage Pay");
});

test("Undo restores an edited interest line", async ({ page, request }) => {
  const s = await seed(request);
  await s.interest(50000);
  await openLoan(page, s, "−$199,850.00");
  await realClick(page, button(interestSection(page), "Edit interest"));
  const d = dialog(page, "Edit Interest");
  await d.getByLabel("Amount").fill("1075");
  await realClick(page, button(d, "Save"));
  await expect(ending(page)).toHaveText("−$199,875.00");
  // The loan page has no Undo button of its own: the plan's stack is the app's, so Undo on another page reaches it.
  await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole("link", { name: /ZZ-TEST Mortgage/ }).click();
  await expect(ending(page)).toHaveText("−$199,850.00");
  await expect(interestSection(page)).toContainText("−$1,050.00");
});
