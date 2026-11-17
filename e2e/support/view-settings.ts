import type { APIRequestContext } from "@playwright/test";
import { call } from "./register-seed";

/** Sets view settings through the API. `scope` is an account id, or "all" for All Accounts. */
export async function setViewSettings(
  request: APIRequestContext,
  plan: string,
  scope: string,
  patch: Record<string, unknown>,
) {
  const path =
    scope === "all"
      ? `/api/v1/budgets/${plan}/view_settings/all_accounts`
      : `/api/v1/budgets/${plan}/accounts/${scope}/view_settings`;
  return (await call(request, "PUT", path, patch)).view_settings;
}

export const viewSettingsOf = async (request: APIRequestContext, plan: string, scope: string) =>
  (
    await call(
      request,
      "GET",
      scope === "all"
        ? `/api/v1/budgets/${plan}/view_settings/all_accounts`
        : `/api/v1/budgets/${plan}/accounts/${scope}/view_settings`,
    )
  ).view_settings;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
/** The 15th of the month `n` months back. */
export const monthsAgo = (n: number) => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() - n, 15));
};
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A plan with ZZ Balance (Starting Balance +500.00 three days ago, a +30.00 refund, a -20.00 and a -600.00
 * outflow on the days after: balances 500.00, 530.00, 510.00, -90.00) and an untouched ZZ Other. API only.
 */
export async function seedBalances(request: APIRequestContext, startingBalance = 500000) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: `ZZ-TEST view ${Math.random().toString(36).slice(2, 8)}`,
  });
  const plan = budget.id as string;
  const open = async (name: string, balance: number, date: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type: "checking",
        balance,
        date,
      })
    ).account.id as string;
  const a = await open("ZZ Balance", startingBalance, daysAgo(3));
  const b = await open("ZZ Other", 100000, daysAgo(3));
  const add = (payee: string, amount: number, date: string, extra: Record<string, unknown> = {}) =>
    call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
      account_id: a,
      date,
      amount,
      payee_name: payee,
      cleared: "cleared",
      ...extra,
    });
  await add("ZZ Refund", 30000, daysAgo(2), { inflow_to_ready_to_assign: true });
  await add("ZZ Fuel", -20000, daysAgo(1));
  await add("ZZ Big", -600000, daysAgo(0));
  return { plan, a, b };
}
