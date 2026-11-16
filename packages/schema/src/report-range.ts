/** Date-range arithmetic for the Reflect reports. Pure: every function is given "today"'s facts. */
export type Month = string; // YYYY-MM-01

export const RANGE_PRESETS = [
  "this_month",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "year_to_date",
  "last_year",
  "all_dates",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export interface RangeFacts {
  first_month: Month;
  current_month: Month;
}
export interface MonthSpan {
  start_month: Month;
  end_month: Month;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function monthIndex(m: Month): number {
  return Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
}
export function monthAt(index: number): Month {
  const y = Math.floor(index / 12);
  return `${pad(y, 4)}-${pad(index - y * 12 + 1)}-01`;
}
export function addMonthsTo(m: Month, n: number): Month {
  return monthAt(monthIndex(m) + n);
}
export function monthOfDate(isoDate: string): Month {
  return `${isoDate.slice(0, 7)}-01`;
}
export function monthCount(r: MonthSpan): number {
  return monthIndex(r.end_month) - monthIndex(r.start_month) + 1;
}
export function monthsIn(r: MonthSpan): Month[] {
  return Array.from({ length: Math.max(0, monthCount(r)) }, (_, i) =>
    addMonthsTo(r.start_month, i),
  );
}
export function planFirstMonth(earliest: Month | null, current: Month): Month {
  if (!earliest || monthIndex(earliest) > monthIndex(current)) return current;
  return earliest;
}

export function presetSpan(p: Exclude<RangePreset, "custom">, f: RangeFacts): MonthSpan {
  const cur = f.current_month;
  const back = (n: number) => ({ start_month: addMonthsTo(cur, -n), end_month: cur });
  switch (p) {
    case "this_month":
      return back(0);
    case "last_3_months":
      return back(2);
    case "last_6_months":
      return back(5);
    case "last_12_months":
      return back(11);
    case "year_to_date":
      return { start_month: `${cur.slice(0, 4)}-01-01`, end_month: cur };
    case "last_year": {
      const y = Number(cur.slice(0, 4)) - 1;
      return { start_month: `${pad(y, 4)}-01-01`, end_month: `${pad(y, 4)}-12-01` };
    }
    case "all_dates":
      return { start_month: f.first_month, end_month: cur };
  }
}

export function clampSpan(r: MonthSpan, f: RangeFacts): MonthSpan {
  const first = monthIndex(f.first_month);
  const cur = monthIndex(f.current_month);
  const start = Math.max(monthIndex(r.start_month), first);
  const end = Math.min(monthIndex(r.end_month), cur);
  if (start <= end) return { start_month: monthAt(start), end_month: monthAt(end) };
  // Entirely before the plan, or entirely after today.
  return monthIndex(r.end_month) < first
    ? { start_month: f.first_month, end_month: f.first_month }
    : { start_month: f.current_month, end_month: f.current_month };
}

export function resolveRange(
  p: RangePreset,
  custom: { start_month: Month | null; end_month: Month | null } | null,
  f: RangeFacts,
): MonthSpan {
  let span: MonthSpan;
  if (p === "custom") {
    span =
      custom?.start_month && custom.end_month
        ? { start_month: custom.start_month, end_month: custom.end_month }
        : presetSpan("all_dates", f);
  } else span = presetSpan(p, f);
  return clampSpan(span, f);
}

export function shiftSpan(r: MonthSpan, dir: -1 | 1): MonthSpan {
  const n = monthCount(r) * dir;
  return { start_month: addMonthsTo(r.start_month, n), end_month: addMonthsTo(r.end_month, n) };
}
export function canShift(r: MonthSpan, dir: -1 | 1, f: RangeFacts): boolean {
  const s = shiftSpan(r, dir);
  return (
    monthIndex(s.start_month) >= monthIndex(f.first_month) &&
    monthIndex(s.end_month) <= monthIndex(f.current_month)
  );
}

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES: readonly string[] = NAMES;
export function monthLabel(m: Month): string {
  return `${NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}
export function shortMonthLabel(m: Month): string {
  return `${m.slice(5, 7)}/${m.slice(2, 4)}`;
}
export function rangeLabel(r: MonthSpan): string {
  return r.start_month === r.end_month
    ? monthLabel(r.start_month)
    : `${monthLabel(r.start_month)} – ${monthLabel(r.end_month)}`;
}
