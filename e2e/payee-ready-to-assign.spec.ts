import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { realClick } from "./support/real-click";
import { call, payeeList, seed, TODAY } from "./support/register-seed";

const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function withEmployer(request: import("@playwright/test").APIRequestContext) {
  const s = await seed(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: 250000,
    payee_name: "ZZ-TEST Employer",
    inflow_to_ready_to_assign: true,
  });
  await expect
    .poll(async () => (await payeeList(request, s.plan)).find((p) => p.name === "ZZ-TEST Employer"))
    .toMatchObject({ last_category_id: null, last_inflow_to_ready_to_assign: true });
  return s;
}

test("Tab on the payee fills Inflow: Ready to Assign, and saving gives an inflow to Ready to Assign", async ({
  page,
  request,
}) => {
  const s = await withEmployer(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await realClick(page, button(page, "Add Transaction"));
  await payee(page).fill("ZZ-TEST Emp");
  await payee(page).press("Tab");
  await expect(payee(page)).toHaveValue("ZZ-TEST Employer");
  await expect(category(page)).toHaveValue("Inflow: Ready to Assign");
  await page.getByRole("textbox", { name: "Inflow", exact: true }).fill("40");
  await realClick(page, button(page, "Save"));
  await expect
    .poll(async () => {
      const list = (await call(
        request,
        "GET",
        `/api/v1/budgets/${s.plan}/accounts/${s.checking}/transactions`,
      )) as { transactions: { amount: number; inflow_to_ready_to_assign: boolean }[] };
      return list.transactions
        .filter((t) => t.amount === 40000)
        .map((t) => t.inflow_to_ready_to_assign);
    })
    .toEqual([true]);
});

test("picking the payee with the real mouse fills it too; a chosen category is kept", async ({
  page,
  request,
}) => {
  const s = await withEmployer(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await realClick(page, button(page, "Add Transaction"));
  await payee(page).fill("ZZ-TEST Emp");
  await realClick(page, page.getByRole("option", { name: "ZZ-TEST Employer", exact: true }));
  await expect(category(page)).toHaveValue("Inflow: Ready to Assign");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+N");
  await expect(category(page)).toHaveValue("");
  await category(page).fill("D4 Groc");
  await page.keyboard.press("Tab");
  await expect(category(page)).toHaveValue(/D4 Groceries/);
  await payee(page).fill("ZZ-TEST Emp");
  await payee(page).press("Tab");
  await expect(payee(page)).toHaveValue("ZZ-TEST Employer");
  await expect(category(page)).toHaveValue(/D4 Groceries/);
});
