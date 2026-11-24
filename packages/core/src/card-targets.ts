import type { CardPayment } from "./card-payment";
import type { Milliunits } from "./money";
import type { Month } from "./month";
import { toMonth } from "./month";
import {
  ceilCent,
  computeTargetMonth,
  lastDay,
  monthsBetween,
  percentOf,
  type TargetDefinition,
  type TargetMonth,
  type TargetMonthContext,
  type TargetStatus,
} from "./targets";

// EXF-538: targets of credit card payment categories. Pure; the card's balances are an input. Stored in the
// ordinary target columns (no migration): see docs/targets-engine-design.md.

export const CARD_TARGET_TYPES = ["card_payoff_by_date", "card_monthly"] as const;
export type CardTargetType = (typeof CARD_TARGET_TYPES)[number];

/** Which card target a stored definition is (only meaningful for a payment category's target). */
export function cardTargetType(
  def: Pick<TargetDefinition, "cadence" | "behavior">,
): CardTargetType {
  return def.cadence === "custom" && def.behavior === "balance"
    ? "card_payoff_by_date"
    : "card_monthly";
}

/** The storage encoding of a card target (the fields of TargetDefinition except created_on). */
export function cardTargetFields(
  type: CardTargetType,
  v: { month?: Month; amount?: Milliunits },
): Omit<TargetDefinition, "created_on"> {
  const none = { day_of_week: null, day_of_month: null, due_date: null, repeat: null };
  if (type === "card_payoff_by_date") {
    return {
      ...none,
      cadence: "custom",
      behavior: "balance",
      amount: 0,
      due_month: v.month ?? null,
    };
  }
  return {
    ...none,
    cadence: "monthly",
    behavior: "set_aside",
    amount: v.amount ?? 0,
    due_month: null,
  };
}

export type CardTargetBalances = Pick<
  CardPayment,
  "prior_balance" | "current_balance" | "available"
>;

const pos = (n: number): number => Math.max(0, n);

/** A payment category's target figures for one month, from the target and the card's balances. */
export function computeCardTargetMonth(
  def: TargetDefinition,
  ctx: TargetMonthContext,
  card: CardTargetBalances,
): TargetMonth | null {
  if (cardTargetType(def) === "card_monthly" || def.due_month === null) {
    return computeTargetMonth(def, ctx);
  }
  const { month, assigned: A } = ctx;
  if (month < toMonth(def.created_on)) return null;
  const due = def.due_month;
  const start = pos(-card.prior_balance);
  const k = Math.max(1, monthsBetween(month, due) + 1);
  const needed = ceilCent(start, k);
  const toGo = pos(needed - A);
  const overall = pos(pos(-card.current_balance) - card.available);
  let status: TargetStatus = overall === 0 ? "funded" : toGo === 0 ? "on_track" : "underfunded";
  const { snoozed_months: snoozed, ...definition } = def;
  if (snoozed?.includes(month)) status = "snoozed";
  return {
    definition,
    status,
    needed_this_month: needed,
    amount_this_month: needed,
    funded: A,
    to_go_this_month: toGo,
    overall_to_go: overall,
    overfunded: pos(A - needed),
    percent: percentOf(start - overall, start),
    due_this_month: due === month,
    period_due_date: lastDay(due),
  };
}
