import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { testName } from "./auth";
import { realClick } from "./real-click";
import { call, TODAY } from "./register-seed";

export type CategorizationSeed = Awaited<ReturnType<typeof seedCategorization>>;

export type PayeeCategoryRow = {
  id: string;
  name: string;
  category_mode: "history" | "fixed" | "off";
  fixed_category_id: string | null;
  fixed_inflow_to_ready_to_assign: boolean;
  default_category_id: string | null;
  default_inflow_to_ready_to_assign: boolean;
};

export const D = { d10: "2026-11-10", d11: "2026-11-11", d12: "2026-11-12", d13: "2026-11-13" };

/**
 * A plan made through the API: ZZ Checking, the group ZZ Daily with Groceries and Fun, and helpers to write one
 * transaction at a time (the stored default depends on the order of writes). Each scenario has its own payee.
 */
export async function seedCategorization(request: APIRequestContext) {
  const name = testName("categorize");
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name });
  const plan = budget.id as string;
  await call(request, "PATCH", `/api/v1/budgets/${plan}`, { opened: true });
  const checking = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 2500000,
      date: TODAY,
    })
  ).account.id as string;
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Daily" })
  ).category_group.id as string;
  const category = async (n: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
        group_id: group,
        name: n,
      })
    ).category.id as string;
  const groceries = await category("Groceries");
  const fun = await category("Fun");

  const tx = async (payee_name: string, over: Record<string, unknown> = {}) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date: D.d10,
        amount: -1250,
        payee_name,
        ...over,
      })
    ).transaction as { id: string; category_id: string | null };
  const payee = async (n: string) =>
    (
      (await call(request, "GET", `/api/v1/budgets/${plan}/payees?include_hidden=true`))
        .payees as PayeeCategoryRow[]
    ).find((p) => p.name === n) as PayeeCategoryRow;
  const payeeId = async (n: string) => (await payee(n)).id;

  const one = async (n = "ZZ Cafe One") => {
    await tx(n, { date: D.d10, category_id: fun });
    return n;
  };
  const majority = async (n = "ZZ Cafe Majority") => {
    await tx(n, { date: D.d10, category_id: groceries, amount: -1250 });
    await tx(n, { date: D.d11, category_id: groceries, amount: -2340 });
    await tx(n, { date: D.d12, category_id: fun, amount: -3460 });
    await call(request, "POST", `/api/v1/budgets/${plan}/scheduled-transactions`, {
      account_id: checking,
      date_first: "2099-01-15",
      frequency: "monthly",
      amount: -4000,
      payee_name: n,
      category_id: fun,
    });
    const bare = await tx(n, { date: D.d13, amount: -5000 });
    if (bare.category_id !== null) {
      await call(request, "PATCH", `/api/v1/budgets/${plan}/transactions/${bare.id}`, {
        category_id: null,
      });
    }
    const rows = (
      (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${checking}/transactions`))
        .transactions as {
        id: string;
        date: string;
        category_id: string | null;
        inflow_to_ready_to_assign: boolean;
      }[]
    ).find((t) => t.id === bare.id);
    expect(rows?.category_id).toBeNull();
    expect(rows?.inflow_to_ready_to_assign).toBe(false);
    await expect
      .poll(async () => (await payee(n)).default_category_id, { timeout: 15000 })
      .toBe(groceries);
    return n;
  };
  const tie = async (n = "ZZ Cafe Tie") => {
    await tx(n, { date: D.d10, category_id: groceries });
    await tx(n, { date: D.d12, category_id: fun, amount: -3460 });
    return n;
  };
  /** One uncategorised row only: no counted row. */
  const empty = async (n = "ZZ Cafe Empty") => {
    await tx(n, { date: D.d13 });
    return n;
  };
  return {
    name,
    plan,
    checking,
    groceries,
    fun,
    group: "ZZ Daily",
    tx,
    payee,
    payeeId,
    one,
    majority,
    tie,
    empty,
  };
}

export const payeeCombo = (page: Page) =>
  page.getByRole("combobox", { name: "Payee", exact: true });
export const categoryCombo = (page: Page) =>
  page.getByRole("combobox", { name: "Category", exact: true });

export const addRow = (page: Page) =>
  realClick(page, page.getByRole("button", { name: "Add Transaction", exact: true }));

export async function pickByMouse(page: Page, name: string) {
  await payeeCombo(page).fill(name.slice(0, name.length - 2));
  await realClick(page, page.getByRole("option", { name, exact: true }));
  await expect(payeeCombo(page)).toHaveValue(name);
}

export async function pickByTab(page: Page, name: string) {
  await payeeCombo(page).fill(name.slice(0, name.length - 2));
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await payeeCombo(page).press("Tab");
  await expect(payeeCombo(page)).toHaveValue(name);
}
