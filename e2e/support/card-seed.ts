import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./auth";
import { call } from "./register-seed";

export const NOV = "2026-11-01";
export const CLOCK = "2026-11-16";
export const CARD_DAY = "2026-11-10";

/** The browser's clock, fixed at local noon of 2026-11-16: the app's "today". */
export const fixCardClock = (page: Page) => page.clock.setFixedTime(new Date(`${CLOCK}T12:00:00`));

/**
 * A plan with ZZ-TEST Checking (1,000.00), Savings, ZZ-TEST Asset (tracking), the card ZZ-TEST Visa (opened at 0),
 * Groceries assigned 335.00 (or `spent`) in November, and a Visa Groceries row of -335.00 dated 2026-11-10. Options add a line of
 * credit, a second card, and a long card name. API only.
 */
export async function seedCard(
  request: APIRequestContext,
  opts: { loc?: boolean; visa2?: boolean; visaName?: string; spent?: number } = {},
) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("card") });
  const plan = budget.id as string;
  const open = async (name: string, type: string, balance: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance,
        date: CARD_DAY,
      })
    ).account.id as string;
  const checking = await open("ZZ-TEST Checking", "checking", 1000000);
  const savings = await open("ZZ-TEST Savings", "savings", 500000);
  const asset = await open("ZZ-TEST Asset", "otherAsset", 2000000);
  const visa = await open(opts.visaName ?? "ZZ-TEST Visa", "creditCard", 0);
  const loc = opts.loc ? await open("ZZ-TEST Line", "lineOfCredit", 0) : null;
  const visa2 = opts.visa2 ? await open("ZZ-TEST Visa Two", "creditCard", 0) : null;
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Spending" })
  ).category_group.id as string;
  const groceries = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: group,
      name: "ZZ Groceries",
    })
  ).category.id as string;
  const spent = opts.spent ?? 335000;
  await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${NOV}/categories/${groceries}`, {
    assigned: opts.spent ?? 335000,
  });
  await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
    account_id: visa,
    date: CARD_DAY,
    amount: -spent,
    payee_name: "ZZ Market",
    category_id: groceries,
  });
  return { plan, checking, savings, asset, visa, loc, visa2, groceries };
}

/** Pays the card through the API (cash -amount, card +amount) on 2026-11-10. */
export const payCard = (
  request: APIRequestContext,
  plan: string,
  card: string,
  from: string,
  amount?: number,
) =>
  call(request, "POST", `/api/v1/budgets/${plan}/accounts/${card}/payments`, {
    from_account_id: from,
    date: CARD_DAY,
    ...(amount === undefined ? {} : { amount }),
  });

export const paymentAvailable = async (
  request: APIRequestContext,
  plan: string,
  card: string,
): Promise<number> => {
  const m = await call(request, "GET", `/api/v1/budgets/${plan}/months/${NOV}`);
  const cat = m.groups
    .flatMap(
      (g: { categories: { account_id: string | null; available: number }[] }) => g.categories,
    )
    .find((c: { account_id: string | null }) => c.account_id === card);
  return cat.available as number;
};
