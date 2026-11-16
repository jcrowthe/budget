import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { MonthCategory, type MonthCategoryDetail, type MonthDetail } from "./months";
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
  "paid_last_month",
  "average_paid",
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
    paid_last_month: Milliunits,
    average_paid: Milliunits,
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
  /** A card's Payments made by transfers from another account (>= 0); 0 for an ordinary category. */
  paid: number;
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
  last_paid: number;
  average_paid: number;
  /** A payment category's Total Underfunded; set only when it is the only category in scope. */
  payment_underfunded: number;
  /** A credit card payment category: it has no target yet and its activity is not spending (EXF-532). */
  payment: boolean;
}

/** The strategies that leave a credit card payment category's Assigned unchanged. */
export const PAYMENT_SKIPS: readonly AutoAssignStrategy[] = [
  "reduce_overfunding",
  "spent_last_month",
  "average_spent",
];

/** The strategies that leave an ordinary category's Assigned unchanged (they read card payments). */
export const ORDINARY_SKIPS: readonly AutoAssignStrategy[] = ["paid_last_month", "average_paid"];

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
): Pick<
  AutoAssignInput,
  | "last_assigned"
  | "last_spent"
  | "average_assigned"
  | "average_spent"
  | "last_paid"
  | "average_paid"
> {
  const byMonth = new Map(previous.map((p) => [monthIndex(p.month), p]));
  const m = monthIndex(month);
  const last = byMonth.get(m - 1);
  const from = Math.max(monthIndex(firstMonth), m - AVERAGE_MONTHS);
  let assigned = 0;
  let spent = 0;
  let paid = 0;
  let n = 0;
  for (let i = from; i < m; i++) {
    const f = byMonth.get(i);
    assigned += f?.assigned ?? 0;
    spent += spending(f?.activity ?? 0);
    paid += f?.paid ?? 0;
    n++;
  }
  return {
    last_assigned: last?.assigned ?? 0,
    last_spent: spending(last?.activity ?? 0),
    average_assigned: meanCent(assigned, n),
    average_spent: meanCent(spent, n),
    last_paid: last?.paid ?? 0,
    average_paid: meanCent(paid, n),
  };
}

/** A snoozed target counts as no target. */
const active = (c: Pick<AutoAssignInput, "target">) =>
  c.target && c.target.status !== "snoozed" ? c.target : null;

const removable = (c: Pick<AutoAssignInput, "assigned" | "target">): number => {
  const t = active(c);
  return t ? Math.min(t.overfunded, Math.max(c.assigned, 0)) : 0;
};

/** The Assigned a category gets from one strategy. */
export function autoAssignResult(c: AutoAssignInput, s: AutoAssignStrategy): number {
  if (c.payment && PAYMENT_SKIPS.includes(s)) return c.assigned;
  if (!c.payment && ORDINARY_SKIPS.includes(s)) return c.assigned;
  switch (s) {
    case "underfunded":
      return c.assigned + (c.payment ? c.payment_underfunded : (active(c)?.to_go_this_month ?? 0));
    case "assigned_last_month":
      return c.last_assigned;
    case "spent_last_month":
      return c.last_spent;
    case "average_assigned":
      return c.average_assigned;
    case "average_spent":
      return c.average_spent;
    case "paid_last_month":
      return c.last_paid;
    case "average_paid":
      return c.average_paid;
    case "reduce_overfunding":
      return c.assigned - removable(c);
    case "reset_available":
      return -(c.carried + c.activity);
    case "reset_assigned":
      return 0;
  }
}

export interface HiddenInput {
  assigned: number;
  target: CategoryTargetMonth | null;
  payment: boolean;
  payment_underfunded: number;
}

/**
 * The two amounts that decide whether their buttons show (EXF-624): the web computes them from the cached
 * month, the service from its own reads, with this one function. A payment category adds its Total Underfunded
 * only when `payment_underfunded` is set (it is the only category in scope).
 */
export function hiddenAmounts(cs: readonly HiddenInput[]): {
  underfunded: number;
  reduce_overfunding: number;
} {
  let underfunded = 0;
  let reduce = 0;
  for (const c of cs) {
    if (c.payment) {
      underfunded += c.payment_underfunded;
      continue;
    }
    underfunded += active(c)?.to_go_this_month ?? 0;
    reduce += removable(c);
  }
  return { underfunded, reduce_overfunding: reduce };
}

/** Each button's amount over a set of categories. Underfunded and Reduce Overfunding are amounts added or removed. */
export function autoAssignPreview(cs: readonly AutoAssignInput[]): AutoAssignPreview {
  const sum = (f: (c: AutoAssignInput) => number) => cs.reduce((n, c) => n + f(c), 0);
  const total = (s: AutoAssignStrategy) => sum((c) => autoAssignResult(c, s));
  // Payment categories are left out of the sums that would read their targets or their activity.
  const others = cs.filter((c) => !c.payment);
  const cards = cs.filter((c) => c.payment);
  const sumOthers = (f: (c: AutoAssignInput) => number) => others.reduce((n, c) => n + f(c), 0);
  const sumCards = (f: (c: AutoAssignInput) => number) => cards.reduce((n, c) => n + f(c), 0);
  const totalOthers = (s: AutoAssignStrategy) => sumOthers((c) => autoAssignResult(c, s));
  const hidden = hiddenAmounts(cs);
  return {
    category_count: cs.length,
    underfunded: hidden.underfunded,
    assigned_last_month: total("assigned_last_month"),
    spent_last_month: totalOthers("spent_last_month"),
    average_assigned: total("average_assigned"),
    average_spent: totalOthers("average_spent"),
    paid_last_month: sumCards((c) => autoAssignResult(c, "paid_last_month")),
    average_paid: sumCards((c) => autoAssignResult(c, "average_paid")),
    reduce_overfunding: hidden.reduce_overfunding,
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

export type AutoAssignScope = "one" | "many" | "payment";

/** The height of the Auto-Assign card for these options: the source's arithmetic (EXF-616). */
export function autoAssignHeight(options: readonly AutoAssignOption[]): number {
  const n = options.length;
  const g = new Set(options.map((o) => o.group)).size;
  return 88 + 32 * n + 2 * (n - g) + 16 * (g - 1);
}

/**
 * The buttons in order, with the ones that are hidden left out. Reduce Overfunding is left out at 0 in every
 * scope; Underfunded at 0 only for one category or one payment category (not for "many"). The rows are decided
 * by `hidden` when given (the web draws them before the preview arrives), else by `p`.
 */
export function autoAssignOptions(
  p: AutoAssignPreview,
  scope: AutoAssignScope,
  hidden?: { underfunded: number; reduce_overfunding: number },
): AutoAssignOption[] {
  const s = scope === "many" ? "s" : "";
  const decide = hidden ?? p;
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
      strategy: "paid_last_month",
      group: 2,
      label: "Paid Last Month",
      amount: p.paid_last_month,
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
      strategy: "average_paid",
      group: 2,
      label: "Average Paid",
      amount: p.average_paid,
      title: "Assign your historical average paid to this card.",
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
    // EXF-624, reversed by the Lead after the source was seen: Underfunded shows at $0.00 over several categories
    // (the plan-wide card, a view, several ticked) and hides at $0.00 for one category.
    if (o.strategy === "underfunded") return scope === "many" || decide.underfunded !== 0;
    if (o.strategy === "reduce_overfunding")
      return scope !== "payment" && decide.reduce_overfunding !== 0;
    if (o.strategy === "spent_last_month" || o.strategy === "average_spent")
      return scope !== "payment";
    if (o.strategy === "paid_last_month" || o.strategy === "average_paid")
      return scope === "payment";
    return true;
  });
}

/**
 * The inputs of `hiddenAmounts` for the categories `ids` of a month read. A payment category's Total
 * Underfunded counts only when it is the only category in scope.
 */
export function monthHiddenInputs(detail: MonthDetail, ids: readonly string[]): HiddenInput[] {
  const byId = new Map<string, MonthCategoryDetail>(
    detail.groups.flatMap((g) => g.categories).map((c) => [c.id, c]),
  );
  return ids.flatMap((id): HiddenInput[] => {
    const c = byId.get(id);
    if (!c) return [];
    return [
      {
        assigned: c.assigned,
        target: c.target,
        payment: c.kind === "credit_card_payment",
        payment_underfunded: ids.length === 1 && c.payment ? c.payment.underfunded : 0,
      },
    ];
  });
}
