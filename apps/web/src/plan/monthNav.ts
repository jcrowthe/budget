import { addMonths, type Month } from "@budget/core/month";
import type { MonthRange } from "@budget/schema/months";

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-11-01" -> "Nov 2026". */
export function monthLabel(month: Month): string {
  return new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface NavLimits {
  earliest: Month;
  furthest: Month;
}

/** The server reports facts; "today" (the person's local month) is applied here. Months compare as strings. */
export function navLimits(range: MonthRange | undefined, current: Month): NavLimits | null {
  if (!range) return null;
  const last = range.last_assigned_month ?? current;
  return {
    earliest: range.first_month < current ? range.first_month : current,
    furthest: addMonths(last > current ? last : current, 1),
  };
}

export const canPrev = (month: Month, l: NavLimits | null) => !!l && month > l.earliest;
export const canNext = (month: Month, l: NavLimits | null) => !!l && month < l.furthest;
export const inLimits = (m: Month, l: NavLimits | null) =>
  !!l && m >= l.earliest && m <= l.furthest;

export const NEXT_DISABLED_TITLE =
  "Before you can move to next month, you need to assign money this month.";
