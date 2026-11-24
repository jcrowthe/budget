import type { APIRequestContext } from "@playwright/test";
import { authHeaders, testName } from "./auth";
import { call } from "./register-seed";

export const NOV = "2026-11-01";
export const CLOCK = "2026-11-16";
export const CARD = "ZZ Debt Card";

/**
 * A plan with ZZ Checking (2,000.00) and the card ZZ Debt Card opened at 1,200.00 owed. With `example`, the
 * ticket's payoff example: the payment category assigned 100.00, a 100.00 payment from checking, a 12.00 card
 * row in a category assigned 12.00. API only.
 */
export async function seedCardTarget(request: APIRequestContext, opts: { example?: boolean } = {}) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("cardtarget"),
  });
  const plan = budget.id as string;
  const base = `/api/v1/budgets/${plan}`;
  const open = async (name: string, type: string, balance: number) =>
    (await call(request, "POST", `${base}/accounts`, { name, type, balance, date: "2026-11-02" }))
      .account.id as string;
  const checking = await open("ZZ Checking", "checking", 2000000);
  const card = await open(CARD, "creditCard", 1200000);
  const month = await call(request, "GET", `${base}/months/${NOV}`);
  const pay = month.groups
    .flatMap((g: { categories: { id: string; account_id: string | null }[] }) => g.categories)
    .find((c: { account_id: string | null }) => c.account_id === card).id as string;
  if (opts.example) {
    const group = (await call(request, "POST", `${base}/category_groups`, { name: "ZZ Group" }))
      .category_group.id as string;
    const food = (
      await call(request, "POST", `${base}/categories`, { group_id: group, name: "ZZ Food" })
    ).category.id as string;
    await call(request, "PATCH", `${base}/months/${NOV}/categories/${food}`, { assigned: 12000 });
    await call(request, "PATCH", `${base}/months/${NOV}/categories/${pay}`, { assigned: 100000 });
    await call(request, "POST", `${base}/transactions`, {
      account_id: checking,
      date: "2026-11-10",
      amount: -100000,
      transfer_account_id: card,
    });
    await call(request, "POST", `${base}/transactions`, {
      account_id: card,
      date: "2026-11-10",
      amount: -12000,
      category_id: food,
    });
  }
  const putTarget = async (body: unknown) => {
    const res = await request.put(`${base}/categories/${pay}/target?today=${CLOCK}`, {
      headers: await authHeaders(),
      data: body,
    });
    return res;
  };
  return { plan, checking, card, pay, putTarget };
}
