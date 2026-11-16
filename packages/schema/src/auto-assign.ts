import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { MonthCategory } from "./months";
import { PlanView } from "./plan-views";
import type { CategoryTargetMonth } from "./targets";

// Pure Auto-Assign arithmetic: what each option sets Assigned to, and the preview beside its button.
// See docs/plan-views-autoassign-design.md.

export const AUTO_ASSIGN_STRATEGIES = [
  "underfunded",
  "assigned_last_month",
  "spent_last_month",
  "average_assigned",
  "average_spent",
  "reduce_overfunding",
  "reset_available",
  "reset_assigned",
] as const;
export const AutoAssignStrategy = z.enum(AUTO_ASSIGN_STRATEGIES).openapi("AutoAssignStrategy");
export type AutoAssignStrategy = z.infer<typeof AutoAssignStrategy>;

export const AutoAssignPreview = z
  .object({
    category_count: z.number().int(),
    underfunded: Milliunits,
    assigned_last_month: Milliunits,
    spent_last_month: Milliunits,
    average_assigned: Milliunits,
    average_spent: Milliunits,
    reduce_overfunding: Milliunits,
    reset_available: Milliunits,
    reset_assigned: Milliunits,
  })
  .openapi("AutoAssignPreview");
export type AutoAssignPreview = z.infer<typeof AutoAssignPreview>;
export const AutoAssignPreviewResponse = dataEnvelope(AutoAssignPreview).openapi(
  "AutoAssignPreviewResponse",
);

export const AutoAssignBody = z
  .object({
    strategy: AutoAssignStrategy,
    category_ids: z.array(z.uuid()).min(1).max(500).optional(),
    view: PlanView.optional(),
  })
  .refine((v) => !(v.category_ids !== undefined && v.view !== undefined), {
    message: "Give category_ids or view, not both",
  })
  .openapi("AutoAssignBody");
export type AutoAssignBody = z.infer<typeof AutoAssignBody>;

export const AutoAssignResult = z
  .object({ month: Month, strategy: AutoAssignStrategy, changed: z.array(MonthCategory) })
  .openapi("AutoAssignResult");
export type AutoAssignResult = z.infer<typeof AutoAssignResult>;
export const AutoAssignResultResponse = dataEnvelope(AutoAssignResult).openapi(
  "AutoAssignResultResponse",
);

export interface MonthFigures {
  month: string;
  assigned: number;
  activity: number;
}

export interface AutoAssignInput {
  id: string;
  assigned: number;
  carried: number;
  activity: number;
  target: CategoryTargetMonth | null;
  last_assigned: number;
  last_spent: number;
  average_assigned: number;
  average_spent: number;
  /** A credit card payment category: it has no target yet and its activity is not spending (EXF-532). */
  payment: boolean;
}

/** The strategies that leave a credit card payment category's Assigned unchanged. */
export const PAYMENT_SKIPS: readonly AutoAssignStrategy[] = [
  "underfunded",
  "reduce_overfunding",
  "spent_last_month",
  "average_spent",
];

/** The most months an average looks back over. */
export const AVERAGE_MONTHS = 12;

const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

const spending = (activity: number): number => Math.max(0, -activity);

/** n / k rounded to a whole cent (10 milliunits), halves away from zero. */
const meanCent = (sum: number, k: number): number =>
  k <= 0 ? 0 : Math.sign(sum) * Math.round(Math.abs(sum) / k / 10) * 10;

/**
 * Last month's and the averaged figures of one category. `previous` holds the months before `month` (any
 * order, at most the last 12 are used); `firstMonth` is the category's first month. A month with nothing counts
 * as zero; no months to average gives 0.
 */
export function historyFigures(
  month: string,
  previous: readonly MonthFigures[],
  firstMonth: string,
): Pick<AutoAssignInput, "last_assigned" | "last_spent" | "average_assigned" | "average_spent"> {
  const byMonth = new Map(previous.map((p) => [monthIndex(p.month), p]));
  const m = monthIndex(month);
  const last = byMonth.get(m - 1);
  const from = Math.max(monthIndex(firstMonth), m - AVERAGE_MONTHS);
  let assigned = 0;
  let spent = 0;
  let n = 0;
  for (let i = from; i < m; i++) {
    const f = byMonth.get(i);
    assigned += f?.assigned ?? 0;
    spent += spending(f?.activity ?? 0);
    n++;
  }
  return {
    last_assigned: last?.assigned ?? 0,
    last_spent: spending(last?.activity ?? 0),
    average_assigned: meanCent(assigned, n),
    average_spent: meanCent(spent, n),
  };
}

/** A snoozed target counts as no target. */
const active = (c: AutoAssignInput) =>
  c.target && c.target.status !== "snoozed" ? c.target : null;

const removable = (c: AutoAssignInput): number => {
  const t = active(c);
  return t ? Math.min(t.overfunded, Math.max(c.assigned, 0)) : 0;
};

/** The Assigned a category gets from one strategy. */
export function autoAssignResult(c: AutoAssignInput, s: AutoAssignStrategy): number {
  if (c.payment && PAYMENT_SKIPS.includes(s)) return c.assigned;
  switch (s) {
    case "underfunded":
      return c.assigned + (active(c)?.to_go_this_month ?? 0);
    case "assigned_last_month":
      return c.last_assigned;
    case "spent_last_month":
      return c.last_spent;
    case "average_assigned":
      return c.average_assigned;
    case "average_spent":
      return c.average_spent;
    case "reduce_overfunding":
      return c.assigned - removable(c);
    case "reset_available":
      return -(c.carried + c.activity);
    case "reset_assigned":
      return 0;
  }
}

/** Each button's amount over a set of categories. Underfunded and Reduce Overfunding are amounts added or removed. */
export function autoAssignPreview(cs: readonly AutoAssignInput[]): AutoAssignPreview {
  const sum = (f: (c: AutoAssignInput) => number) => cs.reduce((n, c) => n + f(c), 0);
  const total = (s: AutoAssignStrategy) => sum((c) => autoAssignResult(c, s));
  // Payment categories are left out of the four sums that would read their targets or their activity.
  const others = cs.filter((c) => !c.payment);
  const sumOthers = (f: (c: AutoAssignInput) => number) => others.reduce((n, c) => n + f(c), 0);
  const totalOthers = (s: AutoAssignStrategy) => sumOthers((c) => autoAssignResult(c, s));
  return {
    category_count: cs.length,
    underfunded: sumOthers((c) => active(c)?.to_go_this_month ?? 0),
    assigned_last_month: total("assigned_last_month"),
    spent_last_month: totalOthers("spent_last_month"),
    average_assigned: total("average_assigned"),
    average_spent: totalOthers("average_spent"),
    reduce_overfunding: sumOthers(removable),
    // The resulting Available of every category is 0 by construction.
    reset_available: 0,
    reset_assigned: 0,
  };
}

export interface AutoAssignOption {
  strategy: AutoAssignStrategy;
  group: 1 | 2 | 3;
  label: string;
  amount: number;
  title: string | null;
}

/** The buttons in order, with the ones that are hidden left out. */
export function autoAssignOptions(p: AutoAssignPreview, scope: "one" | "many"): AutoAssignOption[] {
  const s = scope === "one" ? "" : "s";
  const all: AutoAssignOption[] = [
    { strategy: "underfunded", group: 1, label: "Underfunded", amount: p.underfunded, title: null },
    {
      strategy: "assigned_last_month",
      group: 2,
      label: "Assigned Last Month",
      amount: p.assigned_last_month,
      title: null,
    },
    {
      strategy: "spent_last_month",
      group: 2,
      label: "Spent Last Month",
      amount: p.spent_last_month,
      title: null,
    },
    {
      strategy: "average_assigned",
      group: 2,
      label: "Average Assigned",
      amount: p.average_assigned,
      title: "Feeling average? Fund all of your categories with your historical average assigned.",
    },
    {
      strategy: "average_spent",
      group: 2,
      label: "Average Spent",
      amount: p.average_spent,
      title: "Assign your historical average spent. Though you're above average in my book.",
    },
    {
      strategy: "reduce_overfunding",
      group: 3,
      label: "Reduce Overfunding",
      amount: p.reduce_overfunding,
      title: "Use Reduce Overfunding to remove any funds above your target.",
    },
    {
      strategy: "reset_available",
      group: 3,
      label: `Reset Available Amount${s}`,
      amount: p.reset_available,
      title:
        "Want to start from zero? Set the available amounts of all of your categories to $0.00, making the funds ready to assign. It's like a mini Fresh Start!",
    },
    {
      strategy: "reset_assigned",
      group: 3,
      label: `Reset Assigned Amount${s}`,
      amount: p.reset_assigned,
      title: "Reset all assigned amounts for this month, in case you want a do-over.",
    },
  ];
  return all.filter((o) => {
    if (o.strategy === "underfunded") return !(scope === "one" && o.amount === 0);
    if (o.strategy === "reduce_overfunding") return o.amount !== 0;
    return true;
  });
}
