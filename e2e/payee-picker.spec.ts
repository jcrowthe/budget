import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { hidePayee } from "./support/d1";
import { call, payeeList, seed, TODAY } from "./support/register-seed";

const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("an empty plan shows the hint and Manage Payees disabled", async ({ page, request }) => {
  const s = await seed(request, false);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await button(page, "Add Transaction").click();
  await payee(page).click();
  await expect(page.getByText("Saved Payees", { exact: true })).toBeVisible();
  await expect(page.getByText("Start typing to add a payee.", { exact: true })).toBeVisible();
  await expect(button(page, "Manage Payees")).toBeDisabled();
});

test("system payees are never offered", async ({ page, request }) => {
  const s = await seed(request, false);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await button(page, "Add Transaction").click();
  await payee(page).fill("Start");
  await expect(page.getByRole("option")).toHaveText(['Create "Start" Payee']);
  const list = await payeeList(request, s.plan);
  expect(list.find((p) => p.name === "Starting Balance")?.system).toBe("starting_balance");
});

test("a hidden payee is not listed; its exact name offers it and saving keeps it hidden", async ({
  page,
  request,
}) => {
  const s = await seed(request, false);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: -1000,
    payee_name: "ZZ Hidden",
  });
  const id = (await payeeList(request, s.plan)).find((p) => p.name === "ZZ Hidden")?.id as string;
  hidePayee(id);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await button(page, "Add Transaction").click();
  await payee(page).click();
  await expect(option(page, "ZZ Hidden")).toHaveCount(0);
  await payee(page).fill("ZZ Hid");
  await expect(option(page, "ZZ Hidden")).toHaveCount(0);
  await payee(page).fill("ZZ Hidden");
  await expect(option(page, "1 matching payee is hidden")).toBeVisible();
  await payee(page).press("Tab");
  await button(page, "Save").click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  const list = await payeeList(request, s.plan);
  const mine = list.filter((p) => p.name === "ZZ Hidden");
  expect(mine).toHaveLength(1);
  expect(mine[0]?.hidden).toBe(true);
  expect(mine[0]?.id).toBe(id);
});
