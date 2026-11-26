import { z } from "@hono/zod-openapi";
import type { MonthCategoryDetail, MonthDetail, MonthGroupDetail } from "./months";

import type { CategoryTargetMonth } from "./targets";

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
 * The amount Available After Upcoming falls below zero by, or 0 when nothing is upcoming or it is covered. One
 * function for the browser and the service. `available` is the category's Available.
 */
export function upcomingShortfall(c: { available: number; upcoming: number }): number {
  return c.upcoming !== 0 ? Math.max(0, -(c.available + c.upcoming)) : 0;
}

/**
 * What Underfunded counts for an ordinary category: the larger of an active target's to-go and the upcoming
 * shortfall. The one rule for the view and for Auto-Assign (a snoozed target counts as no target).
 */
export function underfundedGap(target: CategoryTargetMonth | null, shortfall: number): number {
  const active = target !== null && target.status !== "snoozed";
  return Math.max(active ? target.to_go_this_month : 0, shortfall);
}

/** A custom view as the filter sees it: a name and its member category ids. */
export interface CustomViewScope {
  id: string;
  name: string;
  category_ids: readonly string[];
}
export type ViewSelection = PlanView | CustomViewScope;
export const isCustomView = (v: ViewSelection): v is CustomViewScope => typeof v !== "string";

/**
 * Whether a visible category belongs to a view. The one definition: the grid, the panel, both month reads and
 * Auto-Assign all use it. A snoozed target counts as no target.
 */
export function inView(
  c: MonthCategoryDetail,
  view: ViewSelection,
  members?: ReadonlySet<string>,
): boolean {
  if (isCustomView(view)) return (members ?? new Set(view.category_ids)).has(c.id);
  const t = c.target;
  const active = t !== null && t.status !== "snoozed";
  // A credit card payment category keeps its own rule (Auto-Assign never adds an upcoming shortfall to it).
  const shortfall = c.payment === null ? upcomingShortfall(c) : 0;
  switch (view) {
    case "all":
      return true;
    case "overspent":
      return c.available < 0;
    case "underfunded":
      return c.available < 0 || underfundedGap(active ? t : null, shortfall) > 0;
    case "overfunded":
      return active && t.overfunded > 0;
    case "money_available":
      return c.available > 0;
    case "snoozed":
      return c.target_snoozed;
  }
}

/** The visible categories (not hidden, in a group not hidden) the view shows, in grid order. */
export function viewCategories(d: MonthDetail, view: ViewSelection): MonthCategoryDetail[] {
  const all = d.groups
    .filter((g) => !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden));
  if (view === "all") return all;
  const members = isCustomView(view) ? new Set(view.category_ids) : undefined;
  return all.filter((c) => inView(c, view, members));
}

/** The month read narrowed to a view: groups without a match gone, group subtotals over what is left. */
export function viewDetail(d: MonthDetail, view: ViewSelection): MonthDetail {
  if (view === "all") return d;
  const members = isCustomView(view) ? new Set(view.category_ids) : undefined;
  const groups: MonthGroupDetail[] = [];
  for (const g of d.groups) {
    if (g.hidden) continue;
    const categories = g.categories.filter((c) => !c.hidden && inView(c, view, members));
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
