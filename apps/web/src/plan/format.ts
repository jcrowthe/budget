import { formatMoney, type Milliunits } from "@budget/core/money";
import type { MonthCategoryDetail } from "@budget/schema/months";

/** Plan currency formats arrive with EXF-468; until then dollars, with a real minus sign (U+2212). */
export const money = (m: Milliunits): string => formatMoney(m).replace("-", "−");

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

export type Segment = { kind: "spent" | "funded" | "overspent"; pct: number };

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

export const pillTitle = (available: number): string => {
  if (available > 0) {
    return `${money(available)} Available to plan your spending—or click to move it to another category!`;
  }
  if (available < 0) {
    return `${money(available)} A green category is a happy category. Make this category happy by adding funds from surplus categories.`;
  }
  return "";
};
