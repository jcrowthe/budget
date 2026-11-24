import type { MonthCategoryDetail } from "./months";
import { DEFAULT_FORMATTER, type PlanFormatter } from "./plan-formats";
import { amountError } from "./target-form";
import type { CardTargetBody, CardTargetType, TargetDefinition } from "./targets";

// The card target form and wording as plain data (EXF-538): no React, no core import, no clock.

export type CardTargetCategory = Pick<
  MonthCategoryDetail,
  "assigned" | "available" | "target" | "payment"
>;

/** Same rule as core's cardTargetType: a payment category's custom balance target is the payoff one. */
export const cardTargetType = (
  def: Pick<TargetDefinition, "cadence" | "behavior">,
): CardTargetType =>
  def.cadence === "custom" && def.behavior === "balance" ? "card_payoff_by_date" : "card_monthly";

export const CARD_TARGET_LABELS: Record<CardTargetType, string> = {
  card_payoff_by_date: "Pay Off Balance by Date",
  card_monthly: "Pay Specific Amount Monthly",
};
export const CREATE_CARD_TARGET = "Create a Debt Payoff Target";

export interface CardTargetDraft {
  type: CardTargetType;
  /** 0..11 */
  month: number;
  year: number;
  /** Milliunits; 0 until typed. */
  amount: number;
}

/** Payoff by the month after `today`'s, the form's default. */
export function newCardDraft(today: string): CardTargetDraft {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1..12: the 0-based index of next month
  return { type: "card_payoff_by_date", month: m % 12, year: m === 12 ? y + 1 : y, amount: 0 };
}

export function cardDraftFromTarget(def: TargetDefinition, today: string): CardTargetDraft {
  const d = newCardDraft(today);
  if (cardTargetType(def) === "card_monthly")
    return { ...d, type: "card_monthly", amount: def.amount };
  if (def.due_month) {
    return {
      ...d,
      month: Number(def.due_month.slice(5, 7)) - 1,
      year: Number(def.due_month.slice(0, 4)),
    };
  }
  return d;
}

export function cardDraftToBody(
  d: CardTargetDraft,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { body: CardTargetBody } | { errors: { amount?: string } } {
  if (d.type === "card_monthly") {
    return d.amount > 0
      ? { body: { type: "card_monthly", amount: d.amount } }
      : { errors: { amount: amountError(fmt) } };
  }
  const month = `${String(d.year).padStart(4, "0")}-${String(d.month + 1).padStart(2, "0")}-01`;
  return { body: { type: "card_payoff_by_date", month } };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const pos = (n: number) => Math.max(0, n);

const isPayoff = (c: CardTargetCategory) =>
  c.target !== null && cardTargetType(c.target.definition) === "card_payoff_by_date";

/** The view's heading block: the kind's name, then the headline and its subline. */
export function cardTargetHeading(
  c: CardTargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { label: string | null; heading: string; subheading: string } | null {
  const t = c.target;
  if (!t) return null;
  if (isPayoff(c)) {
    return {
      label: null,
      heading: `Pay off ${fmt.money(pos(-(c.payment?.prior_balance ?? 0)))}`,
      subheading: `By ${shortMonth(t.definition.due_month ?? "")}`,
    };
  }
  return {
    label: CARD_TARGET_LABELS.card_monthly,
    heading: fmt.money(t.definition.amount),
    subheading: "Each Month",
  };
}

/** The message under the donut; `assign` is what the Assign button adds (null: nothing to assign). */
export function cardTargetMessage(
  c: CardTargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { text: string; tone: "positive" | "cautious"; assign: number | null } | null {
  const t = c.target;
  if (!t || t.status === "snoozed") return null;
  if (t.status === "funded") {
    return { text: "You've met your target!", tone: "positive", assign: null };
  }
  if (t.status === "on_track") {
    return { text: "You're on track to meet your target!", tone: "positive", assign: null };
  }
  const more = t.funded > 0 ? "more " : "";
  const goal = fmt.money(t.to_go_this_month);
  const text = isPayoff(c)
    ? `Assign ${goal} ${more}this month to stay on track`
    : `Assign ${goal} ${more}to meet your target`;
  return { text, tone: "cautious", assign: t.to_go_this_month };
}

export function cardTargetBreakdown(
  c: CardTargetCategory,
): { label: string; amount: number; rule?: boolean }[] {
  const t = c.target;
  if (!t) return [];
  if (isPayoff(c)) {
    return [
      { label: "Needed for Payoff", amount: pos(-(c.payment?.current_balance ?? 0)) },
      { label: "Available for Payment", amount: c.available },
      { label: "To Go", amount: t.overall_to_go, rule: true },
    ];
  }
  return [
    { label: "Amount to Assign This Month", amount: t.needed_this_month },
    { label: "Assigned So Far", amount: t.funded },
    { label: "To Go", amount: t.to_go_this_month, rule: true },
  ];
}

export const cardTargetDonut = (c: CardTargetCategory): number | null => c.target?.percent ?? null;

/** The grid pill of a payment category with a target; null when the payment pill stands. */
export function cardTargetPill(
  c: CardTargetCategory,
): { tone: "cautious" | "positive" | "zero"; icon: "target" | "check" } | null {
  const t = c.target;
  if (!t || t.status === "snoozed" || c.available < 0) return null;
  if (t.status === "underfunded") return { tone: "cautious", icon: "target" };
  return { tone: c.available === 0 ? "zero" : "positive", icon: "check" };
}

/** The grid row's status line ("$200.00 more needed this month", "Funded"). */
export function cardTargetStatusText(
  c: CardTargetCategory,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { amount: string | null; text: string } | null {
  const t = c.target;
  if (!t || t.status === "snoozed" || c.available < 0) return null;
  if (t.status === "funded") return { amount: null, text: "Funded" };
  if (t.status === "on_track") return { amount: null, text: "On Track" };
  return {
    amount: fmt.money(t.to_go_this_month),
    text: ` ${t.funded > 0 ? "more " : ""}needed this month`,
  };
}
