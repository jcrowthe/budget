import { z } from "@hono/zod-openapi";
import type { MonthCategoryDetail, MonthDetail, MonthGroupDetail } from "./months";

export const PLAN_VIEWS = [
  "all",
  "overspent",
  "underfunded",
  "overfunded",
  "money_available",
  "snoozed",
] as const;
export const PlanView = z.enum(PLAN_VIEWS).openapi("PlanView");
export type PlanView = z.infer<typeof PlanView>;

/**
 * Whether a visible category belongs to a view. The one definition: the grid, the panel, both month reads and
 * Auto-Assign all use it. A snoozed target counts as no target.
 */
export function inView(c: MonthCategoryDetail, view: PlanView): boolean {
  const t = c.target;
  const active = t !== null && t.status !== "snoozed";
  switch (view) {
    case "all":
      return true;
    case "overspent":
      return c.available < 0;
    case "underfunded":
      return c.available < 0 || (active && t.to_go_this_month > 0);
    case "overfunded":
      return active && t.overfunded > 0;
    case "money_available":
      return c.available > 0;
    case "snoozed":
      return c.target_snoozed;
  }
}

/** The visible categories (not hidden, in a group not hidden) the view shows, in grid order. */
export function viewCategories(d: MonthDetail, view: PlanView): MonthCategoryDetail[] {
  const all = d.groups
    .filter((g) => !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden));
  return view === "all" ? all : all.filter((c) => inView(c, view));
}

/** The month read narrowed to a view: groups without a match gone, group subtotals over what is left. */
export function viewDetail(d: MonthDetail, view: PlanView): MonthDetail {
  if (view === "all") return d;
  const groups: MonthGroupDetail[] = [];
  for (const g of d.groups) {
    if (g.hidden) continue;
    const categories = g.categories.filter((c) => !c.hidden && inView(c, view));
    if (categories.length === 0) continue;
    groups.push({
      ...g,
      categories,
      assigned: categories.reduce((n, c) => n + c.assigned, 0),
      activity: categories.reduce((n, c) => n + c.activity, 0),
      available: categories.reduce((n, c) => n + c.available, 0),
    });
  }
  return { ...d, groups, uncategorized: null };
}

export const overspentCount = (d: MonthDetail): number => viewCategories(d, "overspent").length;

export const VIEW_CHIP_LABEL: Record<Exclude<PlanView, "overspent">, string> = {
  all: "All",
  underfunded: "Underfunded",
  overfunded: "Overfunded",
  money_available: "Money Available",
  snoozed: "Snoozed",
};
export const overspentLabel = (n: number): string => `${n} Overspent`;

export const VIEW_EMPTY_TEXT: Record<Exclude<PlanView, "all">, string> = {
  overspent: "You don't currently have any overspent categories.",
  underfunded: "You don't currently have any underfunded categories.",
  overfunded: "You don't currently have any overfunded targets.",
  money_available: "You don't currently have categories with money available.",
  snoozed: "You don't currently have categories with snoozed targets in this month.",
};
export const VIEW_HIDDEN_FOOTER = "Some categories are hidden by your current view.";
export const VIEW_NO_CATEGORIES = "This view has no categories.";
