import type { CategoryMonth } from "./month-categories";
import type { MonthCategoryDetail, MonthDetail, MonthTotals } from "./months";
import { type PlanView, viewCategories } from "./plan-views";

/** Every category that is not hidden, in a group that is not hidden, in grid order. */
export function visibleCategories(d: MonthDetail): MonthCategoryDetail[] {
  return d.groups.filter((g) => !g.hidden).flatMap((g) => g.categories.filter((c) => !c.hidden));
}

/**
 * Totals over the visible categories, or, with `ids`, over exactly those found (hidden ones included).
 * leftover is the sum of `carried`; available = leftover + assigned + activity holds per category.
 */
export function monthTotals(d: MonthDetail, ids?: readonly string[]): MonthTotals {
  const wanted = ids ? new Set(ids) : null;
  const cats = wanted
    ? d.groups.flatMap((g) => g.categories.filter((c) => wanted.has(c.id)))
    : visibleCategories(d);
  const t: MonthTotals = { leftover: 0, assigned: 0, activity: 0, available: 0 };
  for (const c of cats) {
    t.leftover += c.carried;
    t.assigned += c.assigned;
    t.activity += c.activity;
    t.available += c.available;
  }
  return t;
}

/** One category's figures in a month, or null when the month read has no such category. */
export function categoryMonth(d: MonthDetail, id: string): CategoryMonth | null {
  for (const g of d.groups) {
    const c = g.categories.find((x) => x.id === id);
    if (c) {
      return {
        leftover: c.carried,
        assigned: c.assigned,
        cash_activity: c.activity,
        credit_activity: 0,
        available: c.available,
        note: c.note,
      };
    }
  }
  return null;
}

/** Totals over exactly the categories a view shows (the same function the grid uses). */
export function viewTotals(d: MonthDetail, view: PlanView): MonthTotals {
  return monthTotals(
    d,
    viewCategories(d, view).map((c) => c.id),
  );
}
