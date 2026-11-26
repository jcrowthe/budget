import { cardTargetType } from "@budget/core/card-targets";
import { addMilliunits, type Milliunits } from "@budget/core/money";
import type { Month } from "@budget/core/month";
import { ceilCent, countWeekdays, monthsBetween, targetPeriod } from "@budget/core/targets";
import { visibleCategories } from "@budget/schema/month-totals";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";

/**
 * EXF-525 (Cost to Be Me): the flat amount of one category's target in `month`. It is the amount for the
 * month, never what is still needed, and does not depend on funding or snoozes. 0 without a target, and
 * before the month the target was created (the engine returns `target: null` there).
 */
export function targetAmountForMonth(category: MonthCategoryDetail, month: Month): Milliunits {
  const t = category.target;
  if (!t) return 0;
  const def = t.definition;
  if (
    category.kind === "credit_card_payment" &&
    cardTargetType(def) === "card_payoff_by_date" &&
    def.due_month !== null
  ) {
    return t.amount_this_month;
  }
  switch (def.cadence) {
    case "monthly":
      return def.amount;
    case "weekly":
      return def.amount * countWeekdays(month, def.day_of_week ?? 0);
    case "yearly":
      return def.due_date === null ? 0 : ceilCent(def.amount, 12);
    case "custom": {
      if (def.behavior === "balance") {
        return def.due_month !== null && month <= def.due_month
          ? ceilCent(def.amount, monthsBetween(month, def.due_month) + 1)
          : 0;
      }
      const p = targetPeriod(def, month);
      return p === null || p === "complete" ? 0 : ceilCent(def.amount, p.monthsRemaining);
    }
  }
}

/** The sum of every visible category's target amount in the month (the whole plan). */
export function targetsTotal(detail: MonthDetail): Milliunits {
  let total: Milliunits = 0;
  for (const c of visibleCategories(detail)) {
    total = addMilliunits(total, targetAmountForMonth(c, detail.month));
  }
  return total;
}
