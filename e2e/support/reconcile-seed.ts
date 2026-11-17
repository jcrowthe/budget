import type { APIRequestContext } from "@playwright/test";
import { testName } from "./auth";
import { seedCard } from "./card-seed";
import { call, TODAY } from "./register-seed";

type Cleared = "cleared" | "uncleared";

/**
 * Fixture W of the reconcile design, in the plan "ZZ-TEST reconcile <random>": ZZ-TEST Checking (Starting Balance
 * +500.00 cleared; cleared +300.00 ZZ Paycheck and +30.00 ZZ Refund, both Ready to Assign, -45.00 ZZ Grocer, -20.00
 * ZZ Fuel, -9.50 ZZ Pharmacy; uncleared the -100.00 transfer to Savings, -120.00 ZZ Rent, -40.00 ZZ Phone: Cleared
 * 755.50, Uncleared -260.00) and ZZ-TEST Savings (Starting Balance 260.00; its side of the transfer is uncleared). API only.
 */
export async function seedWorked(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("reconcile"),
  });
  const plan = budget.id as string;
  const open = async (name: string, type: string, balance: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ-TEST Checking", "checking", 500000);
  const savings = await open("ZZ-TEST Savings", "savings", 260000);
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Spending" })
  ).category_group.id as string;
  const category = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: group,
      name: "ZZ Outflows",
    })
  ).category.id as string;
  const add = async (
    payee_name: string | null,
    amount: number,
    cleared: Cleared,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date: TODAY,
        amount,
        cleared,
        ...(payee_name ? { payee_name } : {}),
        ...extra,
      })
    ).transaction.id as string;
  await add("ZZ Paycheck", 300000, "cleared", { inflow_to_ready_to_assign: true });
  const refund = await add("ZZ Refund", 30000, "cleared", { inflow_to_ready_to_assign: true });
  await add("ZZ Grocer", -45000, "cleared", { category_id: category });
  const fuel = await add("ZZ Fuel", -20000, "cleared", { category_id: category });
  await add("ZZ Pharmacy", -9500, "cleared", { category_id: category });
  const transfer = await add(null, -100000, "uncleared", { transfer_account_id: savings });
  await add("ZZ Rent", -120000, "uncleared", { category_id: category });
  await add("ZZ Phone", -40000, "uncleared", { category_id: category });
  return { plan, checking, savings, category, refund, fuel, transfer };
}

/** The plan's Ready to Assign for the current month. */
export async function readyToAssign(request: APIRequestContext, plan: string) {
  const month = `${TODAY.slice(0, 7)}-01`;
  return (await call(request, "GET", `/api/v1/budgets/${plan}/months/${month}`))
    .ready_to_assign as number;
}

export const accountOf = async (request: APIRequestContext, plan: string, id: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${id}`)).account as {
    cleared_balance: number;
    uncleared_balance: number;
    balance: number;
    last_reconciled_at: string | null;
  };

export type Row = { id: string; amount: number; cleared: string; payee_name: string | null };
export const rowsOf = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as Row[];

/**
 * A card with a long name ("ZZ-TEST Visa Signature Rewards", for the narrow window) whose balances are near
 * -$12,345.67 (cleared -335.00 and an uncleared -12,010.67) and which has a Payment pill. It is reconciled once.
 */
export async function seedReconcileCard(request: APIRequestContext, reconciled = true) {
  const s = await seedCard(request, { visaName: "ZZ-TEST Visa Signature Rewards" });
  const rows = await rowsOf(request, s.plan, s.visa);
  const market = rows.find((r) => r.payee_name === "ZZ Market");
  if (market) {
    await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${market.id}`, {
      cleared: "cleared",
    });
  }
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.visa,
    date: TODAY,
    amount: -12010670,
    payee_name: "ZZ Big Spend",
    category_id: s.groceries,
  });
  if (reconciled) {
    await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.visa}/reconcile`, {
      statement_balance: -335000,
    });
  }
  return s;
}
