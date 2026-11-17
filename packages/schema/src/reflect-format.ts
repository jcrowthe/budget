import { DEFAULT_FORMATTER, type PlanFormatter } from "./plan-formats";
import { monthLabel } from "./report-range";

/** Reflect's money and axis formatting (milliunits). Pure; a zero is never printed with a minus sign (EXF-591). */

/** Milliunits as whole cents, rounded half away from zero; never -0. */
export function cents(m: number): number {
  const c = Math.sign(m) * Math.round(Math.abs(m) / 10);
  return c === 0 ? 0 : c;
}

/** "$1,234.50", "−$55.00" (U+2212) and "$0.00" at zero cents, in the plan's formats. */
export function reportMoney(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.money(m);
}

/** Debts are drawn negative: "−$4,750.00", and "$0.00" at zero. */
export function debtsMoney(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.money(-Math.abs(m));
}

/** "+$3,300.00", "−$55.00" (U+2212), "$0.00". */
export function signedChange(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.signed(m);
}

/** "−$120.00" (U+2212) below zero cents, else as `reportMoney` (which writes the same sign). */
export function minusMoney(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.money(m);
}

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-01" -> "November 2026". */
export function longMonthLabel(month: string): string {
  return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "D8 Food–OCT 2026" (U+2013, no spaces), or just the name when there is no month. */
export function drillTitle(name: string, month: string | null): string {
  return month === null ? name : `${name}–${monthLabel(month).toUpperCase()}`;
}

/** The drill-down's amount: "+$20.00", "−$150.00" (U+2212), "$0.00". */
export function drillAmount(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.signed(m);
}

/** Whole units for axis ticks; the minus sign only when the rounded unit is not zero. */
export function tickMoney(m: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string {
  return fmt.whole(m);
}

/**
 * Whole-dollar-friendly ticks (milliunits) covering [min, max]: strictly increasing, at most `count`, a step never
 * below one dollar (so no two labels repeat). None when everything is zero.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === 0 && max === 0) return [];
  const range = (max - min) / 1000 || 1;
  const rough = range / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  for (const f of [1, 2, 2.5, 5, 10, 20]) {
    const step = Math.max(1000, f * mag * 1000);
    const lo = Math.floor(min / step);
    const hi = Math.ceil(max / step);
    if (hi - lo + 1 <= count) {
      return Array.from({ length: hi - lo + 1 }, (_, k) => Math.round((lo + k) * step) || 0);
    }
  }
  return [];
}
