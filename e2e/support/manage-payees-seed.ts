import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { testName } from "./auth";
import { mouseClick } from "./menu";
import { call, TODAY } from "./register-seed";

export type PayeeSeed = Awaited<ReturnType<typeof seedPayees>>;

/**
 * A plan made through the API: accounts ZZ Checking and ZZ Card, payees ZZ Phone Co, XX PHONECO 99, ZZ Cafe A (three
 * transactions), ZZ Cafe B (one transaction and one scheduled) and ZZ Unused (its only transaction is deleted).
 */
export async function seedPayees(request: APIRequestContext) {
  const name = testName("payees");
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name });
  const plan = budget.id as string;
  await call(request, "PATCH", `/api/v1/budgets/${plan}`, { opened: true });
  const open = async (n: string, type: string, balance: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name: n,
        type,
        balance,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking", 2500000);
  const card = await open("ZZ Card", "creditCard", 1500000);
  const tx = async (payee_name: string, over: Record<string, unknown> = {}) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date: TODAY,
        amount: -1000,
        payee_name,
        ...over,
      })
    ).transaction as { id: string };
  await tx("ZZ Phone Co");
  await tx("XX PHONECO 99");
  await tx("ZZ Cafe A", { date: "2026-10-01", amount: -1500, memo: "first" });
  await tx("ZZ Cafe A", { date: "2026-10-15", amount: -2500, memo: "second" });
  await tx("ZZ Cafe A", { date: "2026-10-30", amount: -3500, memo: "third" });
  await tx("ZZ Cafe B");
  await call(request, "POST", `/api/v1/budgets/${plan}/scheduled-transactions`, {
    account_id: checking,
    date_first: "2099-01-15",
    frequency: "monthly",
    amount: -4000,
    payee_name: "ZZ Cafe B",
  });
  const gone = await tx("ZZ Unused");
  await call(request, "DELETE", `/api/v1/budgets/${plan}/transactions/${gone.id}`);
  const ids = await payeeIds(request, plan);
  return { name, plan, checking, card, tx, ids };
}

export const payees = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/payees?include_hidden=true`)).payees as {
    id: string;
    name: string;
    hidden: boolean;
    system: string | null;
    transaction_count: number;
    scheduled_count: number;
  }[];

export const payeeIds = async (request: APIRequestContext, plan: string) =>
  Object.fromEntries((await payees(request, plan)).map((p) => [p.name, p.id])) as Record<
    string,
    string
  >;

/** Plan menu → Manage Payees, with a real mouse. */
export async function openManagePayees(page: Page, planName: string) {
  await mouseClick(
    page,
    page
      .getByRole("navigation", { name: "Sidebar" })
      .getByRole("button", { name: planName, exact: true }),
  );
  await mouseClick(page, page.getByRole("menuitem", { name: "Manage Payees", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Manage Payees", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
