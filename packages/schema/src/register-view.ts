import type { ViewSettings } from "./view-settings";

/** Pure register view logic (EXF-529): which rows a view shows. Months are `YYYY-MM-01`. */

const pad = (n: number) => String(n).padStart(2, "0");
const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** `month` moved by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

export function presetRange(
  preset: Exclude<ViewSettings["preset"], "custom">,
  today: string,
  firstMonth: string,
): { from: string; to: string } {
  const now = monthOf(today);
  const year = today.slice(0, 4);
  switch (preset) {
    case "this_month":
      return { from: now, to: now };
    case "last_month": {
      const m = addMonths(now, -1);
      return { from: m, to: m };
    }
    case "latest_3_months":
      return { from: addMonths(now, -2), to: now };
    case "this_year":
      return { from: `${year}-01-01`, to: `${year}-12-01` };
    case "last_year":
      return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-01` };
    case "all_dates":
      return { from: firstMonth, to: addMonths(now, 120) };
  }
}

/** The range a view limits rows to; null when there is no limit (All Dates). */
export function effectiveRange(
  settings: Pick<ViewSettings, "preset" | "range_from" | "range_to">,
  today: string,
  firstMonth: string,
): { from: string; to: string } | null {
  if (settings.preset === "all_dates") return null;
  if (settings.preset === "custom") {
    return settings.range_from && settings.range_to
      ? { from: settings.range_from, to: settings.range_to }
      : null;
  }
  return presetRange(settings.preset, today, firstMonth);
}

export function yearOptions(firstMonth: string, today: string): number[] {
  const thisYear = Number(today.slice(0, 4));
  const first = Math.min(Number(firstMonth.slice(0, 4)), thisYear - 1);
  const out: number[] = [];
  for (let y = first; y <= thisYear + 10; y++) out.push(y);
  return out;
}

/** The rows a view shows and how many it hides. The date range is skipped in reconcile mode. */
export function registerVisible<T extends { date: string; cleared: string }>(
  rows: T[],
  settings: Pick<ViewSettings, "preset" | "range_from" | "range_to" | "show_reconciled">,
  today: string,
  firstMonth: string,
  reconcileMode: boolean,
): { rows: T[]; hidden: number } {
  const range = reconcileMode ? null : effectiveRange(settings, today, firstMonth);
  const shown = rows.filter((r) => {
    if (r.cleared === "reconciled" && !settings.show_reconciled) return false;
    if (range) {
      const m = monthOf(r.date);
      if (m < range.from || m > range.to) return false;
    }
    return true;
  });
  return { rows: shown, hidden: rows.length - shown.length };
}
