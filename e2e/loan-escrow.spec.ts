import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH, TODAY } from "./support/register-seed";

// EXF-1013: Add Escrow, and edit or delete a recorded escrow line (docs/loan-add-activity-design.md,
// docs/loan-manage-design.md). A 200,000.00 mortgage at 6%, escrow 300.00, a 1,500.00 payment today:
// escrow -$300.00 (Set aside by your lender), interest -$1,000.00, balance -$199,800.00.
const dayLabel = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const LOCK = "Reconciled, not editable";
const TEXT =
  "The amount entered becomes the escrow for the chosen month, replacing any estimated or recorded escrow that is not reconciled.";

async function seed(request: APIRequestContext, type: "mortgage" | "autoLoan" = "mortgage") {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("loan escrow"),
  });
  const plan = budget.id as string;
  const open = async (body: Record<string, unknown>) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, { date: MONTH, ...body }))
      .account.id as string;
  const checking = await open({ name: "ZZ-TEST Checking", type: "checking", balance: 50000000 });
  const mortgage = await open({
    name: "ZZ-TEST Mortgage",
    type,
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    ...(type === "mortgage" ? { escrow_amount: 300000 } : {}),
  });
  await call(request, "POST", `/api/v1/budgets/${plan}/accounts/${mortgage}/payments`, {
    from_account_id: checking,
    amount: 1500000,
    date: TODAY,
  });
  const api = (path: string, body: unknown) =>
    call(request, "POST", `/api/v1/budgets/${plan}/accounts/${mortgage}/${path}`, body);
  const escrow = (amount: number) =>
    api("activity", { kind: "escrow", amount, month: MONTH, today: TODAY });
  return { plan, mortgage, api, escrow };
}
type Seed = Awaited<ReturnType<typeof seed>>;

const section = (page: Page, name: string) =>
  page.getByRole("region", { name }).or(page.getByRole("group", { name }));
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "Add Activity" });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const ending = (page: Page) => page.getByTestId("loan-ending-balance");
const escrowSection = (page: Page) => section(page, "Escrow Held");
const interestSection = (page: Page) => section(page, "Interest Charges This Month");

async function openLoan(page: Page, s: Seed, balance = "−$199,800.00") {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await expect(ending(page)).toHaveText(balance);
}
const pick = async (page: Page, item: string) => {
  await realClick(page, button(page, "Add Activity"));
  await realClick(page, menu(page).getByRole("menuitem", { name: item }));
};
const confirmDelete = async (page: Page) => {
  await realClick(page, button(dialog(page, "Edit Escrow"), "Delete"));
  const confirm = page.getByRole("alertdialog", { name: "Delete this line?" });
  await expect(confirm).toBeVisible();
  await realClick(page, button(confirm, "Delete"));
  await expect(confirm).toHaveCount(0);
};

test("Add Escrow records an Edited line and moves the balance", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  await realClick(page, button(page, "Add Activity"));
  const items = menu(page).getByRole("menuitem");
  await expect(items).toHaveCount(5);
  await expect(items.nth(4)).toContainText("Add Escrow");
  await expect(items.nth(4)).toContainText("For recording a known escrow amount");
  await realClick(page, items.nth(4));
  const d = dialog(page, "Record Escrow");
  await expect(d).toContainText(TEXT);
  await expect(d.getByLabel("Month")).toHaveValue(MONTH);
  await expect(button(d, "Save")).toBeDisabled();
  await d.getByLabel("Escrow Amount").fill("350");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(escrowSection(page)).toContainText("−$350.00");
  await expect(escrowSection(page)).toContainText(`Edited on ${dayLabel}`);
  await expect(ending(page)).toHaveText("−$199,850.00");
  await expect(interestSection(page)).toContainText("−$1,000.00");
});

test("edit, then delete, an escrow line", async ({ page, request }) => {
  const s = await seed(request);
  await s.escrow(350000);
  await openLoan(page, s, "−$199,850.00");
  await realClick(page, button(escrowSection(page), "Edit escrow"));
  const d = dialog(page, "Edit Escrow");
  await expect(d.getByLabel("Amount")).toHaveValue("350.00");
  await d.getByLabel("Amount").fill("400");
  await realClick(page, button(d, "Save"));
  await expect(d).toHaveCount(0);
  await expect(escrowSection(page)).toContainText("−$400.00");
  await expect(ending(page)).toHaveText("−$199,900.00");
  await realClick(page, button(escrowSection(page), "Edit escrow"));
  await confirmDelete(page);
  await expect(escrowSection(page)).toContainText("Set aside by your lender");
  await expect(escrowSection(page)).toContainText("−$300.00");
  await expect(ending(page)).toHaveText("−$199,800.00");
});

test("a reconciled escrow line shows the lock and has no Edit button", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await s.api("balance-update", { balance: -199800000, today: TODAY });
  await openLoan(page, s);
  const escrow = escrowSection(page);
  await expect(escrow).toContainText("Reconciled");
  await expect(escrow.getByRole("img", { name: LOCK })).toBeVisible();
  await expect(escrow.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
});

test("a mixed month: edit stays above the reconciled part, delete leaves it reconciled", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await s.api("balance-update", { balance: -199800000, today: TODAY });
  await s.escrow(350000);
  await openLoan(page, s, "−$199,850.00");
  const escrow = escrowSection(page);
  await expect(escrow).toContainText("−$350.00");
  await expect(escrow).toContainText(`Edited on ${dayLabel}`);
  await realClick(page, button(escrow, "Edit escrow"));
  const d = dialog(page, "Edit Escrow");
  await d.getByLabel("Amount").fill("300");
  await realClick(page, button(d, "Save"));
  await expect(d).toContainText("Escrow this month can't be less than its reconciled 300.00");
  await expect(d).toBeVisible();
  await confirmDelete(page);
  await expect(escrow).toContainText("Reconciled");
  await expect(escrow).toContainText("−$300.00");
  await expect(escrow.getByRole("img", { name: LOCK })).toBeVisible();
});

test("a loan that is not a mortgage has no Add Escrow", async ({ page, request }) => {
  const s = await seed(request, "autoLoan");
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(page.getByRole("heading", { name: "Account Activity" })).toBeVisible();
  await realClick(page, button(page, "Add Activity"));
  const items = menu(page).getByRole("menuitem");
  await expect(items).toHaveCount(4);
  await expect(menu(page).getByRole("menuitem", { name: /Add Escrow/ })).toHaveCount(0);
});

test("Undo restores an Add Escrow", async ({ page, request }) => {
  const s = await seed(request);
  await openLoan(page, s);
  await pick(page, "Add Escrow");
  await dialog(page, "Record Escrow").getByLabel("Escrow Amount").fill("350");
  await realClick(page, button(dialog(page, "Record Escrow"), "Save"));
  await expect(ending(page)).toHaveText("−$199,850.00");
  // The loan page has no Undo button of its own: the plan's stack is the app's, so Undo on another page reaches it.
  await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole("link", { name: /ZZ-TEST Mortgage/ }).click();
  await expect(ending(page)).toHaveText("−$199,800.00");
  await expect(escrowSection(page)).toContainText("Set aside by your lender");
  await expect(escrowSection(page)).toContainText("−$300.00");
});
