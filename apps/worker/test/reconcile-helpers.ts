import { account, category, DAY, type Json, plan, send, tx } from "./bulk-helpers";

export { actor, DAY, type Json, MONTH, send } from "./bulk-helpers";

export type Worked = {
  b: string;
  checking: string;
  savings: string;
  cat: string;
  paycheck: string;
  refund: string;
  fuel: string;
  transfer: string;
};

/** Fixture W of the design: Checking cleared 755.50, uncleared -260.00; Savings cleared 260.00. */
export async function seedWorkedExample(): Promise<Worked> {
  const b = await plan();
  const checking = await account(b, "checking", 500000);
  const savings = await account(b, "savings", 260000);
  const cat = await category(b);
  const row = (body: Json) => tx(b, { account_id: checking, date: DAY, ...body });
  const paycheck = (
    await row({
      amount: 300000,
      payee_name: "ZZ Paycheck",
      inflow_to_ready_to_assign: true,
      cleared: "cleared",
    })
  ).id;
  const refund = (
    await row({
      amount: 30000,
      payee_name: "ZZ Refund",
      inflow_to_ready_to_assign: true,
      cleared: "cleared",
    })
  ).id;
  await row({ amount: -45000, payee_name: "ZZ Grocer", category_id: cat, cleared: "cleared" });
  const fuel = (
    await row({ amount: -20000, payee_name: "ZZ Fuel", category_id: cat, cleared: "cleared" })
  ).id;
  await row({ amount: -9500, payee_name: "ZZ Pharmacy", category_id: cat, cleared: "cleared" });
  const transfer = (await row({ amount: -100000, transfer_account_id: savings })).id;
  await row({ amount: -120000, payee_name: "ZZ Rent", category_id: cat });
  await row({ amount: -40000, payee_name: "ZZ Phone", category_id: cat });
  return { b, checking, savings, cat, paycheck, refund, fuel, transfer };
}

export const reconcileUrl = (b: string, a: string) =>
  `/api/v1/budgets/${b}/accounts/${a}/reconcile`;
export const reconcile = (b: string, a: string, body: Json) =>
  send(reconcileUrl(b, a), "POST", body);
