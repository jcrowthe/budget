import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./auth";
import { call, TODAY } from "./register-seed";

export type ListedRow = {
  id: string;
  payee_name: string | null;
  amount: number;
  cleared: string;
  approved: boolean;
  import_id: string | null;
  source: string | null;
  flag_color: string | null;
  memo: string | null;
  account_id: string;
  transfer_transaction_id: string | null;
};

/**
 * The plan "ZZ-TEST bulk <random>": ZZ Checking (Starting Balance $655.50, cleared), ZZ Savings (on budget,
 * $1,000.00), ZZ Asset (tracking, $5,000.00) and the category D4 Groceries. On Checking: uncleared -$100.00
 * (ZZ Rent) and -$60.00 (ZZ Gas), cleared +$250.00 (ZZ Pay) and -$4.50 (ZZ Fee). API only.
 */
export async function seedBulk(request: APIRequestContext) {
  const name = testName("bulk");
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name });
  const plan = budget.id as string;
  const open = async (n: string, type: string, balance: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name: n,
        type,
        balance,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking", 655500);
  const savings = await open("ZZ Savings", "savings", 1000000);
  const asset = await open("ZZ Asset", "otherAsset", 5000000);
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "D4 Bulk" })
  ).category_group.id as string;
  const category = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: group,
      name: "D4 Groceries",
    })
  ).category.id as string;
  const add = async (
    payee_name: string,
    amount: number,
    cleared: "cleared" | "uncleared",
    extra: Record<string, unknown> = {},
  ) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date: TODAY,
        amount,
        payee_name,
        cleared,
        category_id: category,
        ...extra,
      })
    ).transaction.id as string;
  const rent = await add("ZZ Rent", -100000, "uncleared");
  const gas = await add("ZZ Gas", -60000, "uncleared");
  const pay = await add("ZZ Pay", 250000, "cleared");
  const fee = await add("ZZ Fee", -4500, "cleared");
  return { plan, name, checking, savings, asset, category, rent, gas, pay, fee, add };
}

export const accountRows = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as ListedRow[];

export const accountBalance = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}`)).account
    .balance as number;

/**
 * Rewrites the register's list answers in the browser (`patch` returns the fields to change for a row, or null),
 * for states no API makes, such as a reconciled or an unapproved imported row. It never writes the database.
 */
export async function rewriteList(
  page: Page,
  patch: (row: ListedRow) => Partial<ListedRow> | null,
) {
  const handler = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // A refetch still in flight when the test ends must not fail it.
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const body = await res.json();
    body.data.transactions = body.data.transactions.map((t: ListedRow) => ({
      ...t,
      ...(patch(t) ?? {}),
    }));
    return route.fulfill({ response: res, json: body });
  };
  await page.route(/\/api\/v1\/budgets\/[^/]+\/accounts\/[^/]+\/transactions(\?.*)?$/, handler);
  await page.route(/\/api\/v1\/budgets\/[^/]+\/transactions(\?.*)?$/, handler);
}
