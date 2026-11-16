import { formatMoney, type Milliunits } from "@budget/core/money";
import type { Month } from "@budget/core/month";
import { targetBar } from "@budget/core/targets";
import type { MonthCategoryDetail } from "@budget/schema/months";
import { pillTitle, targetPill } from "@budget/schema/target-wording";

export { pillTitle };

/** Plan currency formats arrive with EXF-468; until then dollars, with a real minus sign (U+2212). */
export const money = (m: Milliunits): string => formatMoney(m).replace("-", "−");

/** "+$40.00" for a positive amount, else the plain amount ("−$30.00", "$0.00"). */
export const signed = (m: Milliunits): string => (m > 0 ? `+${money(m)}` : money(m));

/** The full English month name of a first-of-month date, "November". */
export const longMonth = (m: Month): string =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

type Amounts = Pick<MonthCategoryDetail, "activity" | "assigned" | "carried">;

export function spentFunded(c: Amounts): { spent: number; funded: number } {
  return { spent: c.activity < 0 ? -c.activity : 0, funded: c.assigned + c.carried };
}

/** Status label of a category without a target. Target labels belong to the targets area. */
export function statusLabel(c: MonthCategoryDetail): string | null {
  const { spent, funded } = spentFunded(c);
  if (spent <= 0) return null;
  if (c.available < 0) return `Overspent. ${money(spent)} of ${money(funded)}`;
  if (c.available === 0) return "Fully Spent";
  return `Spent ${money(spent)} of ${money(funded)}`;
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

/** The pill look of a category: the overspending state first, else its target's, else the plain pill (null). */
export function categoryPill(c: MonthCategoryDetail): {
  tone: "zero" | "positive" | "negative" | "cautious";
  icon: "clock" | "check" | "clockCheck" | "snooze" | "card" | null;
  title: string;
} | null {
  const over = overspentPill(c);
  if (over) return { ...over, title: pillTitle(c.available) };
  return c.target ? targetPill(c) : null;
}
