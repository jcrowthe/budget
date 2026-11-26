import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH, TODAY } from "./support/register-seed";

// EXF-542: Add Activity on a loan's page. A 200,000.00 mortgage at 6%, escrow 300.00, a 1,500.00 payment today:
// interest -$1,000.00 (Estimated), balance -$199,800.00. The date is the real one.
const MENU = [
  ["Add Payment", "For payments to reduce your balance"],
  ["Add Credit", "For credits or refunds to your account"],
  ["Add Fee or Charge", "For late fees, annual fees, or withdrawals"],
  ["Add Interest", "For recording known interest accrual"],
  ["Add Escrow", "For recording a known escrow amount"],
] as const;

const dayLabel = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const monthText = new Date(`${MONTH}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan add activity"),
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
  await call(request, "POST", `/api/v1/budgets/${plan}/accounts/${mortgage}/payments`, {
    from_account_id: checking,
    amount: 1500000,
    date: TODAY,
  });
  return { plan, checking, mortgage };
}

const monthRead = async (request: APIRequestContext, plan: string) =>
  call(request, "GET", `/api/v1/budgets/${plan}/months/${MONTH}`);
const plain = async (request: APIRequestContext, plan: string) => {
  const m = await monthRead(request, plan);
  return {
    rta: m.ready_to_assign,
    cats: m.groups.flatMap((g: { categories: Record<string, unknown>[] }) =>
      g.categories.map((c) => [c.id, c.budgeted, c.activity, c.available]),
    ),
  };
};
const section = (page: Page, name: string) =>
  page.getByRole("region", { name }).or(page.getByRole("group", { name }));
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "Add Activity" });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

async function openLoan(page: Page, s: { plan: string; mortgage: string }) {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(page.getByTestId("loan-ending-balance")).toHaveText("−$199,800.00");
}
const pick = async (page: Page, item: string) => {
  await realClick(page, button(page, "Add Activity"));
  await realClick(page, menu(page).getByRole("menuitem", { name: item }));
};
const ending = (page: Page) => page.getByTestId("loan-ending-balance");

test("AC1: the Add Activity menu has four items and Add Payment opens Record Payment", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openLoan(page, s);
  const add = button(page, "Add Activity");
  await expect(add).toHaveAttribute("aria-haspopup", "menu");
  await realClick(page, add);
  const items = menu(page).getByRole("menuitem");
  await expect(items).toHaveCount(5);
  for (const [i, [label, subtitle]] of MENU.entries()) {
    await expect(items.nth(i)).toContainText(label);
    await expect(items.nth(i)).toContainText(subtitle);
    await expect(items.nth(i)).toHaveAccessibleName(new RegExp(`^${label}`));
  }
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await pick(page, "Add Payment");
  await expect(dialog(page, "Record Payment")).toBeVisible();
});

test("AC2: Add Interest adds to the month's interest and shows it as Edited", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openLoan(page, s);
  await expect(section(page, "Interest Charges This Month")).toContainText("Estimated");
  await pick(page, "Add Interest");
  const d = dialog(page, "Record Interest");
  await expect(d).toContainText(
    "Interest recorded will be in addition to any existing estimated or recorded interest in the chosen month.",
  );
  await expect(d.getByLabel("Month").locator("option:checked")).toHaveText(monthText);
  await expect(button(d, "Save")).toBeDisabled();
  await d.getByLabel("Interest Amount").fill("50");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  const interest = section(page, "Interest Charges This Month");
  await expect(interest).toContainText("−$1,050.00");
  await expect(interest).toContainText(`Edited on ${dayLabel}`);
  await expect(ending(page)).toHaveText("−$199,850.00");
});

test("AC3: Add Fee or Charge and Add Credit change the balance and list in Other Activity", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openLoan(page, s);
  await pick(page, "Add Fee or Charge");
  const f = dialog(page, "Record New Charge");
  await expect(f).toContainText(
    "This is for charges against your account other than interest or escrow: new withdrawals, late fees, annual fees, etc.",
  );
  await expect(f).toContainText(
    "Remember to set additional money aside in your plan for payment if you do not want these new charges to carry forward as increased debt.",
  );
  await f.getByLabel("Amount").fill("25");
  await f.getByLabel("Memo").fill("ZZ-TEST late fee");
  await realClick(page, button(f, "Save"));
  await expect(f).toHaveCount(0);
  await expect(ending(page)).toHaveText("−$199,825.00");
  const other = section(page, "Other Activity");
  await expect(other).toContainText(`Fee or Charge on ${dayLabel}: ZZ-TEST late fee`);
  await expect(other).toContainText("−$25.00");

  await pick(page, "Add Credit");
  const c = dialog(page, "Record Credit or Refund");
  await expect(c).toContainText(
    "This is for credits or refunds to your account, other than payments.",
  );
  await expect(c).toContainText(
    "This amount will be credited towards your account balance, but will not be included in Ready to Assign or in your plan category balance.",
  );
  await c.getByLabel("Amount").fill("10");
  await realClick(page, button(c, "Save"));
  await expect(c).toHaveCount(0);
  await expect(ending(page)).toHaveText("−$199,815.00");
  await expect(other).toContainText(`Credit on ${dayLabel}`);
  await expect(other.locator(".loan-badge")).toHaveText("3");
});

test("AC4: Ready to Assign and the categories do not change", async ({ page, request }) => {
  const s = await seed(request);
  const before = await plain(request, s.plan);
  await openLoan(page, s);
  await pick(page, "Add Interest");
  await dialog(page, "Record Interest").getByLabel("Interest Amount").fill("50");
  await realClick(page, button(dialog(page, "Record Interest"), "Save"));
  await expect(ending(page)).toHaveText("−$199,850.00");
  await pick(page, "Add Fee or Charge");
  await dialog(page, "Record New Charge").getByLabel("Amount").fill("25");
  await realClick(page, button(dialog(page, "Record New Charge"), "Save"));
  await expect(ending(page)).toHaveText("−$199,875.00");
  await pick(page, "Add Credit");
  await dialog(page, "Record Credit or Refund").getByLabel("Amount").fill("10");
  await realClick(page, button(dialog(page, "Record Credit or Refund"), "Save"));
  await expect(ending(page)).toHaveText("−$199,865.00");
  expect(await plain(request, s.plan)).toEqual(before);
});

test("Undo restores the estimated interest and the balance", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  await pick(page, "Add Interest");
  await dialog(page, "Record Interest").getByLabel("Interest Amount").fill("50");
  await realClick(page, button(dialog(page, "Record Interest"), "Save"));
  await expect(ending(page)).toHaveText("−$199,850.00");
  // The loan page has no Undo button of its own: the plan's stack is the app's, so Undo on another page reaches it.
  await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole("link", { name: /ZZ-TEST Mortgage/ }).click();
  await expect(ending(page)).toHaveText("−$199,800.00");
  await expect(section(page, "Interest Charges This Month")).toContainText("Estimated");
});
