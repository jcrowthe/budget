import { MINIMUM_SUMMARY } from "./debt-target";
import { payoffLabel } from "./loan-summary";

// EXF-544: the Loan Payoff Simulator's copy as plain data: no React, no clock. docs/loan-simulator-design.md.

export { MINIMUM_SUMMARY };
export const SIMULATION_TIP =
  "Estimated future balance if you pay the updated amounts on the left side of the simulator.";
export const EXTRA_HINT = "Extra one-off payments can have a large impact on your loan.";
export const ESCROW_NOTE = "Escrow amounts are not included";
export const COPY_TO_PLAN = "Copy and go to my plan";
export const RESET_ALL = "Reset all changes";
export const TARGET_SUMMARY = "Paying your target every month:";

type Money = (milliunits: number) => string;

/** "$1,500.00 is your current monthly target." / "... is your required minimum payment." */
export function paymentHint(source: "target" | "minimum", amount: number, money: Money): string {
  return `${money(amount)} is ${source === "target" ? "your current monthly target" : "your required minimum payment"}.`;
}

/** Unchanged: the payments left. Changed: the original payoff month. */
export function payoffHint(v: {
  changed: boolean;
  n: number | null;
  originalPayoff: string | null;
}): string {
  if (v.changed) return `Your original payoff date is ${payoffLabel(v.originalPayoff)}`;
  return v.n === null ? "" : `You have ${v.n} payments remaining on your loan.`;
}

const MONTH_NAMES = [
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
/** "2026-11-01" -> "One time extra in November". */
export const extraLabel = (month: string): string =>
  `One time extra in ${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ""}`;

/** One line per change: the monthly difference from the loan's current payment and the one-time extra. */
export function changeLines(v: { deltaMonthly: number; extra: number }, money: Money): string[] {
  const lines: string[] = [];
  if (v.deltaMonthly > 0) lines.push(`Paying +${money(v.deltaMonthly)} extra every month`);
  if (v.deltaMonthly < 0) lines.push(`Paying ${money(-v.deltaMonthly)} less every month`);
  if (v.extra > 0) lines.push(`Paying +${money(v.extra)} extra this month`);
  return lines;
}
