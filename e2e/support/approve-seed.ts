import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./auth";
import { call, TODAY } from "./register-seed";
import { daysAgo, monthsAgo } from "./view-settings";

/**
 * A plan of its own for the approve specs: ZZ Checking and ZZ Savings (on plan, cash), "ZZ Group: ZZ Food", two
 * approved categorized rows and three rows with `approved: false` in ZZ Checking (two categorized, one without a
 * category). The rows are real: the server counts them, so the banner, Approve and the bar work end to end.
 */
export async function seedApprove(
  request: APIRequestContext,
  opts: { savingsUnapproved?: boolean; old?: boolean; reconciledUnapproved?: boolean } = {},
) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("approve") });
  const plan = budget.id as string;
  const open = async (name: string, type: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance: 0,
        date: daysAgo(40),
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking");
  const savings = await open("ZZ Savings", "savings");
  const g = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Group" })
  ).category_group.id;
  const food = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: g,
      name: "ZZ Food",
    })
  ).category.id as string;
  const add = async (account: string, payee: string, amount: number, day: number, extra = {}) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: account,
        date: daysAgo(day),
        amount,
        payee_name: payee,
        ...extra,
      })
    ).transaction.id as string;
  await add(checking, "ZZ Ok One", -1000, 9, { category_id: food });
  await add(checking, "ZZ Ok Two", -2000, 8, { category_id: food });
  const unapproved = [
    await add(checking, "ZZ New One", -3000, 3, { category_id: food, approved: false }),
    await add(checking, "ZZ New Two", -4000, 2, { category_id: food, approved: false }),
    await add(checking, "ZZ New Bare", -5000, 1, { approved: false }),
  ];
  const extra: Record<string, string> = {};
  if (opts.savingsUnapproved) {
    extra.savingsRow = await add(savings, "ZZ Sav New", -6000, 1, {
      category_id: food,
      approved: false,
    });
  }
  if (opts.old) {
    extra.oldRow = await add(checking, "ZZ Old New", -7000, 0, {
      category_id: food,
      approved: false,
      date: monthsAgo(3),
    });
  }
  if (opts.reconciledUnapproved) {
    extra.reconciledRow = await add(checking, "ZZ Rec New", -8000, 30, {
      category_id: food,
      approved: false,
      cleared: "cleared",
    });
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts/${checking}/reconcile`, {
      statement_balance: -8000,
    });
  }
  return { plan, checking, savings, food, group: g as string, unapproved, ...extra };
}

export const BANNER = (n: number) =>
  n === 1
    ? "1 new transaction to approve or categorize."
    : `${n} new transactions to approve or categorize.`;

/**
 * The browser sees these rows as imported (as `e2e/register-bulk.spec.ts` does), and the reject request is answered
 * here: "delete" removes the rows through the server's own API, "409" refuses. Every posted body is recorded.
 */
export async function stubReject(
  page: Page,
  request: APIRequestContext,
  plan: string,
  ids: string[],
  mode: "delete" | "409",
) {
  const posted: { ids: string[] }[] = [];
  const set = new Set(ids);
  await page.route(/\/transactions(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    if (Array.isArray(body?.data?.transactions)) {
      body.data.transactions = body.data.transactions.map((t: { id: string }) =>
        set.has(t.id) ? { ...t, import_id: `zz-imp-${t.id}`, source: "plaid" } : t,
      );
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/transactions\/reject$/, async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    posted.push(body);
    if (mode === "409") {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            id: "x",
            name: "transaction_approved",
            detail: "An approved transaction cannot be rejected",
          },
        },
      });
      return;
    }
    for (const id of body.ids) {
      await call(request, "DELETE", `/api/v1/budgets/${plan}/transactions/${id}`);
    }
    await route.fulfill({ json: { data: { transactions: [] } } });
  });
  return posted;
}

export { TODAY };
