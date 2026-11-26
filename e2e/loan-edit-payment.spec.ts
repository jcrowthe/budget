import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH, TODAY, txs } from "./support/register-seed";

// Loan payments: Edit or delete a payment from the loan's Account Activity; both sides of the transfer change
// together (docs/loan-manage-design.md). A 200,000.00 mortgage at 6%, a 1,500.00 payment from ZZ-TEST Checking today.
const dayLabel = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const LOCK = "Reconciled, not editable";

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan edit payment"),
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
  });
  const paid = await call(
    request,
    "POST",
    `/api/v1/budgets/${plan}/accounts/${mortgage}/payments`,
    { from_account_id: checking, amount: 1500000, date: TODAY },
  );
  const loanTx = paid.to_transaction.id as string;
  const cashTx = paid.from_transaction.id as string;
  const balance = async () =>
    (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${mortgage}`)).account
      .balance as number;
  return { plan, checking, mortgage, loanTx, cashTx, balance };
}
type Seed = Awaited<ReturnType<typeof seed>>;

const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const ending = (page: Page) => page.getByTestId("loan-ending-balance");
const payments = (page: Page) => page.getByRole("region", { name: "Payments" });
const money = (milliunits: number) =>
  `${milliunits < 0 ? "−" : ""}$${(Math.abs(milliunits) / 1000).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function openLoan(page: Page, s: Seed) {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(payments(page)).toContainText("$1,500.00");
}
async function editPayment(page: Page) {
  await realClick(page, button(payments(page), `Edit payment on ${dayLabel}`));
  const d = dialog(page, "Edit Payment");
  await expect(d).toContainText("From ZZ-TEST Checking");
  return d;
}
const checkingRows = async (request: APIRequestContext, s: Seed) =>
  (await txs(request, s.plan, s.checking)).filter((t) => t.id === s.cashTx);

test("edit a payment: both sides, the balance and the register", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  const d = await editPayment(page);
  await expect(d.getByLabel("Amount")).toHaveValue("1,500.00");
  await d.getByLabel("Amount").fill("1600");
  await d.getByLabel("Memo").fill("ZZ-TEST memo");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(payments(page)).toContainText("$1,600.00");
  await expect(ending(page)).toHaveText(money(await s.balance()));
  const [row] = await checkingRows(request, s);
  expect(row).toMatchObject({ amount: -1600000, memo: "ZZ-TEST memo" });
  await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
  const line = page.getByRole("row").filter({ hasText: "ZZ-TEST memo" });
  await expect(line).toContainText("1,600.00");
});

test("move a payment to the previous month", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  const d = await editPayment(page);
  const prev = new Date(`${MONTH}T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const iso = `${prev.toISOString().slice(0, 7)}-20`;
  const typed = await d.getByLabel("Date").inputValue();
  const [y, m, day] = iso.split("-") as [string, string, string];
  // The field takes the plan's date format: keep its separators and order.
  const shaped = typed
    .replace(TODAY.slice(0, 4), y)
    .replace(TODAY.slice(5, 7), m)
    .replace(TODAY.slice(8, 10), day);
  await d.getByLabel("Date").fill(shaped);
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(payments(page)).toContainText("No payments this month");
  await realClick(page, page.getByRole("button", { name: "Previous month" }));
  await expect(payments(page)).toContainText("$1,500.00");
  const [row] = await checkingRows(request, s);
  expect(row?.date).toBe(iso);
});

test("delete a payment: both sides go", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  const d = await editPayment(page);
  await realClick(page, button(d, "Delete"));
  const confirm = page.getByRole("alertdialog", { name: "Delete this payment?" });
  await expect(confirm).toContainText("It is also removed from ZZ-TEST Checking.");
  await realClick(page, button(confirm, "Delete"));
  await expect(confirm).toHaveCount(0);
  await expect(payments(page)).toContainText("No payments this month");
  expect(await checkingRows(request, s)).toHaveLength(0);
});

test("Undo restores an edit and a delete on both sides", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  const d = await editPayment(page);
  await d.getByLabel("Amount").fill("1600");
  await realClick(page, button(d, "Save"));
  await expect(payments(page)).toContainText("$1,600.00");
  const undo = async () => {
    // The loan page has no Undo button of its own: the plan's stack is the app's, so Undo on another page reaches it.
    await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
    const u = page.getByRole("button", { name: "Undo", exact: true });
    await expect(u).toBeEnabled();
    await u.click();
    await page.getByRole("link", { name: /ZZ-TEST Mortgage/ }).click();
  };
  await undo();
  await expect(payments(page)).toContainText("$1,500.00");
  expect((await checkingRows(request, s))[0]?.amount).toBe(-1500000);
  const d2 = await editPayment(page);
  await realClick(page, button(d2, "Delete"));
  await realClick(
    page,
    button(page.getByRole("alertdialog", { name: "Delete this payment?" }), "Delete"),
  );
  await expect(payments(page)).toContainText("No payments this month");
  await undo();
  await expect(payments(page)).toContainText("$1,500.00");
  expect(await checkingRows(request, s)).toHaveLength(1);
});

test("a reconciled side shows the lock and has no Edit button", async ({ page, request }) => {
  const s = await seed(request);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.cashTx}`, {
    cleared: "cleared",
  });
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.checking}/reconcile`, {
    statement_balance: 48500000,
  });
  await openLoan(page, s);
  await expect(payments(page).getByRole("img", { name: LOCK })).toBeVisible();
  await expect(payments(page).getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  const res = await request.fetch(
    `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}/activity/${s.loanTx}`,
    { method: "PATCH", headers: await authHeaders(), data: { amount: 1600000 } },
  );
  expect(res.status()).toBe(409);
  expect((await res.json()).error.name).toBe("reconciled_line");
});
