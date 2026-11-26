import type { APIRequestContext } from "@playwright/test";
import { testName } from "./auth";
import { call, TODAY } from "./register-seed";

/** A plan with "ZZ-TEST Checking", group "ZZ-TEST Group", categories "ZZ-TEST Groceries" and "ZZ-TEST Fun"; the payee ZZ-TEST Market is made by the first schedule that names it. */
export async function seedSplitPlan(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("sched-split"),
  });
  const plan = budget.id as string;
  const checking = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ-TEST Checking",
      type: "checking",
      balance: 1000000,
      date: TODAY,
    })
  ).account.id as string;
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
      name: "ZZ-TEST Group",
    })
  ).category_group.id as string;
  const cat = async (name: string) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/categories`, { group_id: group, name }))
      .category.id as string;
  const groceries = await cat("ZZ-TEST Groceries");
  const fun = await cat("ZZ-TEST Fun");
  return { plan, checking, groceries, fun };
}

export type SchedLine = {
  amount: number;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
};
export type SplitSched = {
  id: string;
  amount: number;
  date_next: string;
  subtransactions: SchedLine[];
};
