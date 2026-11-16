import { env } from "cloudflare:test";
import type { TargetSet } from "@budget/schema/targets";
import { createAccount } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { setTarget } from "../src/services/targets";
import { createTransaction } from "../src/services/transactions";
import { actor } from "./category-helpers";

export const TODAY = "2026-11-15";
export const OCT = "2026-10-01";
export const NOV = "2026-11-01";
export const DEC = "2026-12-01";

/** A plan with one group and the named categories; everything is dated by TODAY (mid-November 2026). */
export async function seedPlan(names: string[], group = "ZZ Group") {
  const budget = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const bid = budget.id;
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: group });
  const ids: Record<string, string> = {};
  for (const name of names) {
    ids[name] = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name })).id;
  }
  return {
    bid,
    ids,
    groupId: g.id,
    assign: (name: string, month: string, assigned: number) =>
      setAssigned(env, actor, {
        budget_id: bid,
        month,
        category_id: ids[name] as string,
        assigned,
      }),
    spend: (name: string, date: string, amount: number) =>
      createTransaction(env, actor, {
        budget_id: bid,
        account_id: account.id,
        date,
        amount: -amount,
        category_id: ids[name] as string,
        inflow_to_ready_to_assign: false,
      }),
    target: (name: string, def: Omit<TargetSet, "budget_id" | "category_id">) =>
      setTarget(
        env,
        actor,
        { ...def, budget_id: bid, category_id: ids[name] as string } as TargetSet,
        {
          today: TODAY,
        },
      ),
  };
}

export const MONTHLY100 = { cadence: "monthly", behavior: "set_aside", amount: 100000 } as const;
