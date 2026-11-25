import { DEFAULT_FORMATTER, type PlanFormatter } from "./plan-formats";
import { amountError } from "./target-form";
import { ordinal } from "./target-wording";
import type { DebtPaymentTargetBody, TargetDefinition } from "./targets";

// The Debt Payment Target's copy and draft as plain data (EXF-545): no React, no core import, no clock.

export const DEBT_TARGET_TITLE = "Debt Payment Target";
export const CREATE_DEBT_TARGET = "Create Debt Payment Target";
export const PAIRED_WITH = "Paired with";
export const AVAILABLE_FOR_PAYMENT = "Available for Payment";
export const NO_PAYMENTS_YET = "No payments recorded yet";
export const OPEN_PAYOFF_SIMULATOR = "Open Payoff Simulator";
export const RECORD_PAYMENT = "Record Payment";
export const MINIMUM_SUMMARY = "Paying the minimum every month:";
export const SUMMARY_LABELS = {
  minimum: "Minimum Payment",
  timeRemaining: "Time Remaining",
  principal: "Principal",
  remaining: "Remaining to Pay",
  interestRemaining: "Interest Remaining",
} as const;

export const pairedWithText = (loanName: string): string => `${PAIRED_WITH} ${loanName} Account`;
export const paidThisMonthText = (amount: number, fmt: PlanFormatter = DEFAULT_FORMATTER): string =>
  `${fmt.money(amount)} paid this month`;
/** "Interest (6%)" */
export const interestLabel = (rate: string | null): string => `Interest (${rate ?? "0"}%)`;

/** "30 years", "29 yrs, 11 mos", "10 months", "1 month"; "—" when the loan is never paid off. */
export function durationText(months: number | null): string {
  if (months === null) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} ${m === 1 ? "month" : "months"}`;
  if (m === 0) return `${y} ${y === 1 ? "year" : "years"}`;
  return `${y} ${y === 1 ? "yr" : "yrs"}, ${m} ${m === 1 ? "mo" : "mos"}`;
}

export const EVERY_OPTIONS: { value: "last" | number; label: string }[] = [
  { value: "last", label: "Last Day of Month" },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: ordinal(i + 1) })),
];

/** The saved view's heading block. */
export function debtTargetHeading(
  def: Pick<TargetDefinition, "amount" | "day_of_month">,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { label: string; heading: string; subheading: string; by: string } {
  return {
    label: "Monthly Debt Payment",
    heading: fmt.money(def.amount),
    subheading: "Needed Each Month",
    by:
      def.day_of_month === null
        ? "By the End of the Month"
        : `By the ${ordinal(def.day_of_month)} of the Month`,
  };
}

export interface DebtDraft {
  /** Milliunits; 0 until typed. */
  amount: number;
  day: "last" | number;
}

/** The form's start: the loan's minimum payment, due on the last day. */
export const newDebtDraft = (minimum: number): DebtDraft => ({ amount: minimum, day: "last" });

export const debtDraftFromTarget = (
  def: Pick<TargetDefinition, "amount" | "day_of_month">,
): DebtDraft => ({
  amount: def.amount,
  day: def.day_of_month ?? "last",
});

export function debtDraftToBody(
  d: DebtDraft,
  fmt: PlanFormatter = DEFAULT_FORMATTER,
): { body: DebtPaymentTargetBody } | { errors: { amount?: string } } {
  return d.amount > 0
    ? { body: { type: "debt_payment", amount: d.amount, day: d.day } }
    : { errors: { amount: amountError(fmt) } };
}
