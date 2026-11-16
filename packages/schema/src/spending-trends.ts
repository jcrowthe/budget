/**
 * Spending Trends arithmetic (milliunits, integers only). Pure: the Worker gives it the counted rows (the rule is
 * `spendingRows` in the reports repository) and the span; "today" never enters here, it only chose the span.
 */
import { type MonthSpan, monthCount, monthsIn } from "./report-range";
import type { SpendingTrends } from "./reports";
import { UNCATEGORIZED_ID } from "./reports";
import { centsRound, type SpendingRow } from "./spending-breakdown";

export const TRENDS_UNCATEGORIZED_NAME = "Uncategorized Transactions";

/** n ÷ d as a percent with one decimal, rounded half up (n >= 0, d > 0). Integers only. */
export function tenthsHalfUp(n: number, d: number): number {
  return Math.floor((2000 * n + d) / (2 * d)) / 10;
}

/** |diff| as a percent of |avg|, one decimal; 0 when the average is 0. */
export function comparedPct(diff: number, avg: number): number {
  return avg === 0 ? 0 : tenthsHalfUp(Math.abs(diff), Math.abs(avg));
}

interface Series {
  id: string;
  name: string;
  /** Spending positive. */
  total: number;
  order: [number, number];
  byMonth: Map<string, number>;
}

export function computeTrends(input: {
  rows: readonly SpendingRow[];
  span: MonthSpan;
  group: { id: string; name: string } | null;
}): SpendingTrends {
  const { span, group } = input;
  const months = monthsIn(span);
  const n = monthCount(span);
  const inSpan = new Set(months);

  const all = new Map<string, Series>();
  for (const r of input.rows) {
    const month = `${r.date.slice(0, 7)}-01`;
    if (!inSpan.has(month)) continue;
    let key: string;
    let make: () => Series;
    if (r.category_id === null || r.group_id === null) {
      if (group) continue;
      key = UNCATEGORIZED_ID;
      make = () => ({
        id: UNCATEGORIZED_ID,
        name: TRENDS_UNCATEGORIZED_NAME,
        total: 0,
        order: [Number.MAX_SAFE_INTEGER, 0],
        byMonth: new Map(),
      });
    } else if (group) {
      if (r.group_id !== group.id) continue;
      key = r.category_id;
      const id = r.category_id;
      make = () => ({
        id,
        name: r.category_name ?? "",
        total: 0,
        order: [r.group_order, r.category_order],
        byMonth: new Map(),
      });
    } else {
      key = r.group_id;
      const id = r.group_id;
      make = () => ({
        id,
        name: r.group_name ?? "",
        total: 0,
        order: [r.group_order, 0],
        byMonth: new Map(),
      });
    }
    const s = all.get(key) ?? make();
    s.total -= r.amount;
    s.byMonth.set(month, (s.byMonth.get(month) ?? 0) - r.amount);
    all.set(key, s);
  }

  // Rank: range total descending, then plan order (Uncategorized sorts last through its order).
  const ranked = [...all.values()].sort(
    (a, b) => b.total - a.total || a.order[0] - b.order[0] || a.order[1] - b.order[1],
  );

  const monthTotals = months.map((m) =>
    ranked.reduce((sum, s) => sum + (s.byMonth.get(m) ?? 0), 0),
  );
  const total = monthTotals.reduce((a, b) => a + b, 0);
  const average = centsRound(total, n);

  return {
    start_month: span.start_month,
    end_month: span.end_month,
    group,
    total,
    average_monthly: average,
    series: ranked.map((s) => ({ id: s.id, name: s.name, total: s.total })),
    months: months.map((m, i) => {
      const present = ranked
        .map((s) => ({ s, amount: s.byMonth.get(m) ?? 0 }))
        .filter((x) => x.amount !== 0);
      const gross = present.reduce((sum, x) => sum + Math.max(x.amount, 0), 0);
      const monthTotal = monthTotals[i] ?? 0;
      const diff = monthTotal - average;
      return {
        month: m,
        total: monthTotal,
        compared_to_average: diff,
        compared_pct: comparedPct(diff, average),
        series: present.map(({ s, amount }) => ({
          id: s.id,
          name: s.name,
          amount,
          share_pct: amount > 0 && gross > 0 ? tenthsHalfUp(amount, gross) : null,
        })),
      };
    }),
  };
}
