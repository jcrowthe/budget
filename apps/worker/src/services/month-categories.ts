import type { AssignedResult, CategoryMonth } from "@budget/schema/month-categories";
import { categoryMonth } from "@budget/schema/month-totals";
import { z } from "zod";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import { getPlanMonth, setAssigned } from "./months";

const isUuid = (s: string) => z.uuid().safeParse(s).success;

/** Sets one category's Assigned for a month, then answers with its new month numbers and Ready to Assign. */
export async function setAssignedAndRead(
  env: Env,
  actor: string,
  input: { budget_id: string; month: string; category_id: string; assigned: number },
): Promise<AssignedResult> {
  if (!isUuid(input.budget_id)) throw new NotFound("Plan");
  if (!isUuid(input.category_id)) throw new NotFound("Category");
  await setAssigned(env, actor, input);
  const m = await getPlanMonth(env, input.budget_id, input.month);
  const c = m.groups.flatMap((g) => g.categories).find((x) => x.id === input.category_id);
  if (!c) throw new NotFound("Category");
  return {
    category: {
      id: c.id,
      month: m.month,
      assigned: c.assigned,
      activity: c.activity,
      available: c.available,
    },
    ready_to_assign: m.ready_to_assign,
  };
}

/** One category's figures for one month, with its note. */
export async function getMonthCategory(
  env: Env,
  budgetId: string,
  month: string,
  categoryId: string,
): Promise<CategoryMonth> {
  if (!isUuid(budgetId)) throw new NotFound("Plan");
  if (!isUuid(categoryId)) throw new NotFound("Category");
  const r = categoryMonth(await getPlanMonth(env, budgetId, month), categoryId);
  if (!r) throw new NotFound("Category");
  return r;
}
