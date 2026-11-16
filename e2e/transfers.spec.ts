import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  accountData,
  call,
  planMonth,
  realClick,
  seedWorked,
  TODAY,
} from "./support/register-seed";

const rows = (page: Page) => page.locator(".register-table tbody tr");
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const inflow = (page: Page) => page.getByRole("textbox", { name: "Inflow", exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const balance = (page: Page, key: string) => page.locator(`[data-balance="${key}"] .acct-amount`);
const JUMP = "Click to jump to the other side of this transfer";

const dayBefore = () => {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    text: `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`,
  };
};

for (const size of [
  { width: 1600, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`a transfer to Savings, both sides, edits, the jump and delete at ${size.width}x${size.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedWorked(request);
    const before = await planMonth(request, s.plan, s.month);
    await page.goto(`/${s.plan}/accounts/${s.checking}`);
    await expect(rows(page)).toHaveCount(3);
    await expect(balance(page, "working")).toHaveText("$410.00");

    // The picker: Payments and Transfers lists every account but this one, above Saved Payees.
    await button(page, "Add Transaction").click();
    await payee(page).click();
    await expect(page.getByText("Payments and Transfers", { exact: true })).toBeVisible();
    await expect(option(page, "To/From ZZ Brokerage")).toBeVisible();
    await expect(option(page, "To/From ZZ Savings")).toBeVisible();
    await expect(option(page, "To/From ZZ Checking")).toHaveCount(0);
    await payee(page).fill("transfer");
    await expect(page.getByRole("option")).toHaveText([
      'Create "transfer" Payee',
      "To/From ZZ Brokerage",
      "To/From ZZ Savings",
    ]);
    await expect(option(page, "To/From ZZ Brokerage")).toHaveAttribute("aria-selected", "true");
    await payee(page).fill("sav");
    await expect(page.getByRole("option", { name: "To/From ZZ Savings" })).toBeVisible();
    await expect(option(page, "Starting Balance")).toHaveCount(0);
    await realClick(page, option(page, "To/From ZZ Savings"));
    await expect(payee(page)).toHaveValue("Transfer : ZZ Savings");
    await expect(category(page)).toBeDisabled();
    await expect(category(page)).toHaveAttribute("placeholder", "Category not needed");
    await outflow(page).fill("50");
    await button(page, "Save").click();

    await expect
      .poll(async () => (await accountData(request, s.plan, s.savings)).transactions.length)
      .toBe(2);
    const checking = await accountData(request, s.plan, s.checking);
    const savings = await accountData(request, s.plan, s.savings);
    const mine = checking.transactions.find((t) => t.amount === -50000);
    const other = savings.transactions.find((t) => t.amount === 50000);
    expect(mine?.transfer_account_id).toBe(s.savings);
    expect(mine?.transfer_transaction_id).toBe(other?.id);
    expect(other?.transfer_transaction_id).toBe(mine?.id);
    expect(other?.cleared).toBe("uncleared");

    // Rows and figures, no reload.
    const row = rows(page).filter({ hasText: "Transfer: ZZ Savings" });
    await expect(row).toContainText("Category not needed");
    await expect(row.getByRole("button", { name: JUMP, exact: true })).toHaveAttribute(
      "title",
      JUMP,
    );
    await expect(row.locator("td[data-field=payee]")).toHaveAttribute(
      "title",
      "Transfer : ZZ Savings",
    );
    await expect(balance(page, "uncleared")).toHaveText("−$170.00");
    await expect(balance(page, "working")).toHaveText("$360.00");
    await expect(
      page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /ZZ Savings/ }),
    ).toContainText("$250.00");
    // The month does not move for an on-plan transfer.
    expect(await planMonth(request, s.plan, s.month)).toEqual(before);

    // ⇆ with the real mouse: the other register, the paired row ticked.
    await realClick(page, row.getByRole("button", { name: JUMP, exact: true }));
    await expect(page).toHaveURL(new RegExp(`/accounts/${s.savings}$`));
    const back = rows(page).filter({ hasText: "Transfer: ZZ Checking" });
    await expect(back).toBeVisible();
    await expect(back).toHaveClass(/is-checked/);
    await expect(back.locator("td[data-field=payee]")).toHaveAttribute(
      "title",
      "Transfer : ZZ Checking",
    );
    await expect(back).toContainText("Category not needed");

    // Edit the Savings side: 60 on the day before; Checking follows, uncleared.
    const day = dayBefore();
    await back.dblclick({ position: { x: 5, y: 5 } });
    await date(page).fill(day.text);
    await inflow(page).fill("60");
    await button(page, "Save").click();
    await expect
      .poll(async () =>
        (await accountData(request, s.plan, s.checking)).transactions.find(
          (t) => t.id === mine?.id,
        ),
      )
      .toMatchObject({ amount: -60000, date: day.iso, cleared: "uncleared" });
    // Clearing one side leaves the other alone.
    await realClick(
      page,
      rows(page)
        .filter({ hasText: "Transfer: ZZ Checking" })
        .getByRole("button", {
          name: /This transaction is uncleared/,
        }),
    );
    await expect(balance(page, "cleared")).toHaveText("$260.00");
    await expect
      .poll(async () => (await accountData(request, s.plan, s.checking)).balances.working)
      .toBe(350000);
    const checkingAfter = await accountData(request, s.plan, s.checking);
    expect(checkingAfter.transactions.find((t) => t.id === mine?.id)?.cleared).toBe("uncleared");

    // Delete either side: both are gone, balances as before.
    await call(request, "DELETE", `/api/v1/budgets/${s.plan}/transactions/${other?.id}`);
    expect((await accountData(request, s.plan, s.checking)).balances.working).toBe(410000);
    expect((await accountData(request, s.plan, s.savings)).balances.working).toBe(200000);
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
  });
}

test("a transfer to a tracking account needs a category on the plan side only", async ({
  page,
  request,
}) => {
  const s = await seedWorked(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rows(page)).toHaveCount(3);
  await button(page, "Add Transaction").click();
  await payee(page).fill("brokerage");
  await realClick(page, option(page, "To/From ZZ Brokerage"));
  // A tracking account takes a category on the plan side.
  await expect(category(page)).toBeEnabled();
  await outflow(page).fill("100");
  await button(page, "Save").click();
  const row = rows(page).filter({ hasText: "Transfer: ZZ Brokerage" });
  await expect(
    row.getByRole("button", { name: "This needs a category", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await accountData(request, s.plan, s.brokerage)).transactions.length)
    .toBe(2);
  const brokerage = await accountData(request, s.plan, s.brokerage);
  expect(brokerage.transactions.find((t) => t.amount === 100000)?.category_id).toBeNull();

  // Give it D4 Fun: Fun's Activity moves by -100.00.
  await row.dblclick({ position: { x: 5, y: 5 } });
  await category(page).fill("d4 fun");
  await realClick(page, option(page, "D4 Fun"));
  await button(page, "Save").click();
  await expect
    .poll(async () => (await planMonth(request, s.plan, s.month)).activity[s.fun])
    .toBe(-115000);
  await expect(balance(page, "working")).toHaveText("$310.00");

  // All Accounts: the Brokerage row shows "Category not needed"; its register has no CATEGORY column.
  await page.goto(`/${s.plan}/accounts`);
  await expect(
    rows(page).filter({ hasText: "ZZ Brokerage" }).filter({ hasText: "Transfer: ZZ Checking" }),
  ).toContainText("Category not needed");
  await page.goto(`/${s.plan}/accounts/${s.brokerage}`);
  await expect(rows(page).filter({ hasText: "Transfer: ZZ Checking" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "CATEGORY", exact: true })).toHaveCount(0);
  await expect(balance(page, "cleared")).toHaveText("$1,000.00");
  await expect(balance(page, "uncleared")).toHaveText("$100.00");
  await expect(balance(page, "working")).toHaveText("$1,100.00");
});
