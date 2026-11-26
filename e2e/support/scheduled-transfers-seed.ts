import type { APIRequestContext } from "@playwright/test";
import { testName } from "./auth";
import { call, TODAY } from "./register-seed";

/** A plan with two on-plan accounts, "ZZ-TEST Checking" and "ZZ-TEST Savings". */
export async function seedTwo(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("xfer") });
  const plan = budget.id as string;
  const open = async (name: string, type: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance: 1000000,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ-TEST Checking", "checking");
  const savings = await open("ZZ-TEST Savings", "savings");
  return { plan, checking, savings };
}

export type RealRow = {
  id: string;
  date: string;
  amount: number;
  payee_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
};

/** An account's real rows, without its starting balance. */
export const realRowsOf = async (request: APIRequestContext, plan: string, account: string) =>
  (
    (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
      .transactions as RealRow[]
  ).filter((t) => t.payee_name !== "Starting Balance");
