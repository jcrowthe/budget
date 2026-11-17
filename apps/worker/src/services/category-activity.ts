import type { Month } from "@budget/core/month";
import { CATEGORY_ACTIVITY_LIMIT, type CategoryActivity } from "@budget/schema/category-activity";
import { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import { categoryActivityRows, findActiveCategory } from "../repositories/category-activity";

const isUuid = (s: string) => z.uuid().safeParse(s).success;

export class PaymentCategoryRefused extends Error {
  constructor() {
    super(
      "A credit card payment category's Activity is moved by the plan from card spending and payments; its transactions are not listed.",
    );
    this.name = "PaymentCategoryRefused";
  }
}

/** The transactions behind one ordinary category's Activity for a month: 3 D1 calls, whatever the rows. */
export async function listCategoryActivity(
  env: Env,
  budgetId: string,
  month: Month,
  categoryId: string,
): Promise<CategoryActivity> {
  if (!isUuid(budgetId)) throw new NotFound("Plan");
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  if (!isUuid(categoryId)) throw new NotFound("Category");
  const category = await findActiveCategory(db, budgetId, categoryId);
  if (!category) throw new NotFound("Category");
  if (category.kind === "credit_card_payment") throw new PaymentCategoryRefused();
  const r = await categoryActivityRows(db, budgetId, categoryId, month, CATEGORY_ACTIVITY_LIMIT);
  return {
    category_id: categoryId,
    month,
    activity: r.activity,
    total_count: r.total,
    transactions: r.rows,
  };
}
