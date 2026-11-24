import type { Month } from "@budget/core/month";
import { targetBar } from "@budget/core/targets";
import { cardTargetPill } from "@budget/schema/card-target";
import type { MonthCategoryDetail } from "@budget/schema/months";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import { pillTitle, targetPill } from "@budget/schema/target-wording";
import type { PillTone } from "./AvailablePill";

export { pillTitle };

/** The full English month name of a first-of-month date, "November". */
export const longMonth = (m: Month): string =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

type Amounts = Pick<MonthCategoryDetail, "activity" | "assigned" | "carried">;

export function spentFunded(c: Amounts): { spent: number; funded: number } {
  return { spent: c.activity < 0 ? -c.activity : 0, funded: c.assigned + c.carried };
}

/** Status label of a category without a target. Target labels belong to the targets area. */
export function statusLabel(c: MonthCategoryDetail, fmt: PlanFormatter): string | null {
  const { spent, funded } = spentFunded(c);
  if (spent <= 0) return null;
  if (c.available < 0) return `Overspent. ${fmt.money(spent)} of ${fmt.money(funded)}`;
  if (c.available === 0) return "Fully Spent";
  return `Spent ${fmt.money(spent)} of ${fmt.money(funded)}`;
}

export type Segment = { kind: "spent" | "funded" | "cautious" | "overspent"; pct: number };
/** One section of the progress bar: its share of the bar and the parts that fill it (shares of the section). */
export type Section = { pct: number; parts: Segment[]; fill: number };

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function barSegments(c: MonthCategoryDetail): Segment[] {
  const { spent, funded } = spentFunded(c);
  let segs: Segment[] = [];
  if (spent > funded) {
    const p = (funded / spent) * 100;
    segs = [
      { kind: "spent", pct: p },
      { kind: "overspent", pct: 100 - p },
    ];
  } else if (spent > 0) {
    const p = (spent / funded) * 100;
    segs = [
      { kind: "spent", pct: p },
      { kind: "funded", pct: 100 - p },
    ];
  } else if (funded > 0) {
    segs = [{ kind: "funded", pct: 100 }];
  }
  return segs.map((s) => ({ ...s, pct: clamp(s.pct) })).filter((s) => s.pct > 0);
}

/** The bar of a category without a target: one section, whose parts are its spent and funded shares. */
export const plainSections = (c: MonthCategoryDetail): Section[] => {
  const parts = barSegments(c);
  return [{ pct: 100, parts, fill: parts.reduce((n, p) => n + p.pct, 0) }];
};

/**
 * The bar of a category with a target: sections sized as the engine's `targetBar` gives them (the leftover,
 * then what is needed, or one section per week), the fill spread over them left to right; inside the fill the
 * first `spent` milliunits are the spent stripes, the rest yellow while underfunded and green otherwise.
 */
export function targetSections(c: MonthCategoryDetail): Section[] {
  const t = c.target;
  if (!t) return plainSections(c);
  const { sections, fill } = targetBar(t, c.carried);
  const sizes = sections.length > 0 ? sections : [1];
  const total = sizes.reduce((n, s) => n + s, 0);
  let left = sections.length > 0 ? Math.min(fill, total) : 0;
  let spent = Math.min(c.activity < 0 ? -c.activity : 0, left);
  const rest = t.status === "underfunded" ? "cautious" : "funded";
  return sizes.map((size) => {
    const taken = Math.min(left, size);
    left -= taken;
    const sp = Math.min(spent, taken);
    spent -= sp;
    const parts: Segment[] = [
      { kind: "spent" as const, pct: (sp / size) * 100 },
      { kind: rest as "cautious" | "funded", pct: ((taken - sp) / size) * 100 },
    ].filter((p) => p.pct > 0);
    return { pct: (size / total) * 100, parts, fill: (taken / size) * 100 };
  });
}

export const amountClass = (n: number): string => (n === 0 ? "amount zero" : "amount");

/**
 * The pill of an overspent category (EXF-535): yellow with a card icon while the overspending is all credit,
 * red (cash or cash and credit) otherwise. Null while the category is not overspent.
 */
export function overspentPill(
  c: Pick<MonthCategoryDetail, "available" | "state">,
): { tone: "cautious" | "negative"; icon: "card" | null } | null {
  if (c.available >= 0) return null;
  return c.state === "credit_overspent"
    ? { tone: "cautious", icon: "card" }
    : { tone: "negative", icon: null };
}

/** The titles of a credit card payment category's pill (the source's tooltip.budget.positivePayment / negativePayment). */
export const paymentPillTitle = (available: number, fmt: PlanFormatter): string => {
  if (available > 0) {
    return `You have ${fmt.money(available)} set aside for payment. (Want to send more? Add money to Assigned.)`;
  }
  if (available < 0) {
    return "Red in your payment? Assign more (and cover overspending) to get back to green!";
  }
  return "";
};

/** The title of a credit-overspent pill (the source's tooltip.budget.creditOverspent); the amount is the credit part. */
export const creditOverspentTitle = (credit: number, fmt: PlanFormatter): string =>
  `You've overspent this category by ${fmt.money(credit)} with credit. Cover this overspending to avoid creating debt!`;

type CategoryPill = {
  tone: "zero" | "positive" | "negative" | "cautious";
  icon: "clock" | "check" | "clockCheck" | "snooze" | "card" | "target" | null;
  title: string;
};

/** The pill look of a category: the overspending state first, else its target's, else the plain pill (null). */
export function categoryPill(c: MonthCategoryDetail, fmt: PlanFormatter): CategoryPill | null {
  const over = overspentPill(c);
  let pill: CategoryPill | null = null;
  if (over) {
    const title =
      over.icon === "card" && c.overspent
        ? creditOverspentTitle(c.overspent.credit, fmt)
        : pillTitle(c.available, fmt);
    pill = { ...over, title };
  } else if (c.target) pill = targetPill(c, fmt);
  if (c.kind === "credit_card_payment") {
    // EXF-537: red when overpaid, yellow when underfunded (even at $0.00), green with money set aside, else grey.
    const tone: PillTone =
      c.available < 0
        ? "negative"
        : (c.payment?.underfunded ?? 0) > 0
          ? "cautious"
          : c.available > 0
            ? "positive"
            : "zero";
    // EXF-538: a target on the card speaks for the pill, unless the card is overpaid or the target is snoozed.
    const card = cardTargetPill(c);
    if (card) return { ...card, title: paymentPillTitle(c.available, fmt) };
    return { tone, icon: null, title: paymentPillTitle(c.available, fmt) };
  }
  return pill;
}
