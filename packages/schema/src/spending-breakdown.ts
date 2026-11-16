/**
 * Spending Breakdown arithmetic (milliunits, integers only). Pure: the Worker gives it the counted rows (the rule is
 * `spendingRows` in the reports repository), the span and the mode; "today" never enters here.
 */
import { csvAmount } from "./net-worth";
import { type MonthSpan, monthCount, monthLabel, monthsIn } from "./report-range";
import type { SpendingBreakdown, SpendingGroupBy } from "./reports";
import { UNCATEGORIZED_ID } from "./reports";

export type { SpendingGroupBy };

/** One counted row: a plain transaction, or one line of a split (never its parent). */
export interface SpendingRow {
  id: string;
  transaction_id: string;
  subtransaction_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  created_at: string;
  split_index: number | null;
  /** Signed: an outflow is negative. */
  amount: number;
  payee_name: string | null;
  memo: string | null;
  cleared: "uncleared" | "cleared" | "reconciled";
  category_id: string | null;
  category_name: string | null;
  category_hidden: boolean;
  category_order: number;
  group_id: string | null;
  group_name: string | null;
  group_hidden: boolean;
  group_order: number;
}

export function daysInMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

/** Calendar days of every month of the range (the current month counts in full). */
export function rangeDays(span: MonthSpan): number {
  return monthsIn(span).reduce((n, m) => n + daysInMonth(m), 0);
}

/** n ÷ d rounded half away from zero to whole cents, as milliunits (a multiple of 10). Integers only. */
export function centsRound(n: number, d: number): number {
  const v = Math.floor((Math.abs(n) * 2 + 10 * d) / (20 * d)) * 10;
  return n < 0 && v !== 0 ? -v : v;
}

/** Share of the total as a whole percent, rounded half up; 0 when the total is 0. */
export function sharePct(item: number, total: number): number {
  return total === 0 ? 0 : Math.floor((200 * item + total) / (2 * total));
}

export function filterRows(
  rows: readonly SpendingRow[],
  f: { excludedCategoryIds: readonly string[]; excludedAccountIds: readonly string[] },
): SpendingRow[] {
  const cats = new Set(f.excludedCategoryIds);
  const accts = new Set(f.excludedAccountIds);
  return rows.filter(
    (r) =>
      !accts.has(r.account_id) &&
      !(r.category_id === null ? cats.has(UNCATEGORIZED_ID) : cats.has(r.category_id)),
  );
}

/** Date descending, then created_at descending, then split index ascending (null first), then id. */
export function newestFirst<
  T extends Pick<SpendingRow, "date" | "created_at" | "split_index" | "id">,
>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  const ai = a.split_index ?? -1;
  const bi = b.split_index ?? -1;
  if (ai !== bi) return ai - bi;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Bucket {
  id: string;
  name: string;
  group_name: string | null;
  sum: number;
  count: number;
  order: [number, number];
}

const orderOf = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];

export function computeBreakdown(input: {
  rows: readonly SpendingRow[];
  span: MonthSpan;
  groupBy: SpendingGroupBy;
  group: { id: string; name: string } | null;
}): SpendingBreakdown {
  const { span, group } = input;
  const groupBy: SpendingGroupBy = group ? "category" : input.groupBy;
  const rows = group ? input.rows.filter((r) => r.group_id === group.id) : input.rows;
  const months = monthCount(span);
  const days = rangeDays(span);

  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    let key: string;
    let make: () => Bucket;
    if (r.category_id === null || r.group_id === null) {
      key = UNCATEGORIZED_ID;
      make = () => ({
        id: UNCATEGORIZED_ID,
        name: "Uncategorized",
        group_name: null,
        sum: 0,
        count: 0,
        order: [Number.MAX_SAFE_INTEGER, 0],
      });
    } else if (groupBy === "group") {
      key = r.group_id;
      const gid = r.group_id;
      make = () => ({
        id: gid,
        name: r.group_name ?? "",
        group_name: null,
        sum: 0,
        count: 0,
        order: [r.group_order, 0],
      });
    } else {
      key = r.category_id;
      const cid = r.category_id;
      make = () => ({
        id: cid,
        name: r.category_name ?? "",
        group_name: r.group_name,
        sum: 0,
        count: 0,
        order: [r.group_order, r.category_order],
      });
    }
    const b = buckets.get(key) ?? make();
    b.sum += r.amount;
    b.count += 1;
    buckets.set(key, b);
  }

  // Listed: net spending above zero (a category that nets to an inflow is off the screen).
  const listed = [...buckets.values()]
    .filter((b) => b.sum < 0)
    .sort((a, b) => a.sum - b.sum || orderOf(a.order, b.order));
  const total = listed.reduce((n, b) => n - b.sum, 0);

  let mostFrequent: Bucket | null = null;
  for (const b of listed) {
    if (!mostFrequent || b.count > mostFrequent.count) mostFrequent = b;
    // On a tie the earlier (larger total, then plan order) stays.
  }

  let largest: SpendingRow | null = null;
  for (const r of rows) {
    if (r.amount >= 0) continue;
    if (
      !largest ||
      r.amount < largest.amount ||
      (r.amount === largest.amount &&
        (r.date > largest.date || (r.date === largest.date && r.id < largest.id)))
    ) {
      largest = r;
    }
  }

  return {
    start_month: span.start_month,
    end_month: span.end_month,
    months,
    days,
    group_by: groupBy,
    group,
    total,
    average_monthly: centsRound(total, months),
    average_daily: centsRound(total, days),
    most_frequent: mostFrequent
      ? { id: mostFrequent.id, name: mostFrequent.name, transaction_count: mostFrequent.count }
      : null,
    largest_outflow: largest
      ? {
          transaction_id: largest.transaction_id,
          payee_name: largest.payee_name,
          amount: -largest.amount,
        }
      : null,
    items: listed.map((b) => ({
      id: b.id,
      name: b.name,
      group_name: b.group_name,
      total: -b.sum,
      share_pct: sharePct(-b.sum, total),
      transaction_count: b.count,
    })),
  };
}

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const BOM = "﻿";
export const HIDDEN_GROUP = "Hidden Categories";

const isHidden = (r: SpendingRow) => r.category_hidden || r.group_hidden;

/** The summary CSV: one row per category with a counted row, spending negative, then Average and Total. */
export function breakdownCsv(rows: readonly SpendingRow[], span: MonthSpan): string {
  const months = monthsIn(span);
  const n = months.length;
  const byCategory = new Map<string, { row: SpendingRow; sums: number[] }>();
  for (const r of rows) {
    const key = r.category_id ?? UNCATEGORIZED_ID;
    const entry = byCategory.get(key) ?? { row: r, sums: months.map(() => 0) };
    const i = months.indexOf(`${r.date.slice(0, 7)}-01`);
    if (i >= 0) entry.sums[i] = (entry.sums[i] ?? 0) + r.amount;
    byCategory.set(key, entry);
  }
  const rank = (e: { row: SpendingRow }): [number, number, number] => {
    if (e.row.category_id === null) return [2, 0, 0];
    return [isHidden(e.row) ? 1 : 0, e.row.group_order, e.row.category_order];
  };
  const entries = [...byCategory.values()].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  const lines = [
    [
      quote("Category Group"),
      quote("Category"),
      ...months.map((m) => quote(monthLabel(m))),
      quote("Average"),
      quote("Total"),
    ].join(","),
  ];
  for (const { row, sums } of entries) {
    const total = sums.reduce((a, b) => a + b, 0);
    const group =
      row.category_id === null ? "" : isHidden(row) ? HIDDEN_GROUP : (row.group_name ?? "");
    const name = row.category_id === null ? "Uncategorized" : (row.category_name ?? "");
    lines.push(
      [
        quote(group),
        quote(name),
        ...sums.map(csvAmount),
        csvAmount(centsRound(total, n)),
        csvAmount(total),
      ].join(","),
    );
  }
  return BOM + lines.join("\n");
}

const dollars = (m: number) => `$${csvAmount(Math.abs(m))}`;
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** The transactions CSV: one row per counted row (a split line is one row), newest first. */
export function transactionsCsv(rows: readonly SpendingRow[]): string {
  const lines = [
    [
      "Account",
      "Flag",
      "Date",
      "Payee",
      "Category Group/Category",
      "Category Group",
      "Category",
      "Memo",
      "Outflow",
      "Inflow",
      "Cleared",
    ]
      .map(quote)
      .join(","),
  ];
  for (const r of [...rows].sort(newestFirst)) {
    let both = "";
    let group = "";
    let category = "";
    if (r.category_id !== null) {
      category = r.category_name ?? "";
      group = isHidden(r) ? HIDDEN_GROUP : (r.group_name ?? "");
      both = `${group}: ${category}`;
    }
    lines.push(
      [
        quote(r.account_name),
        quote(""),
        quote(usDate(r.date)),
        quote(r.payee_name ?? ""),
        quote(both),
        quote(group),
        quote(category),
        quote(r.memo ?? ""),
        dollars(Math.max(-r.amount, 0)),
        dollars(Math.max(r.amount, 0)),
        quote(r.cleared === "uncleared" ? "Uncleared" : "Cleared"),
      ].join(","),
    );
  }
  return BOM + lines.join("\n");
}
