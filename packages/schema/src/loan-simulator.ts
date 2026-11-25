import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
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

// ---- the payoff simulation over REST and MCP (the dialog's numbers, from the same simulatePayoff) ----

export const loanPayoffSimulationFields = {
  monthly_payment: Milliunits.min(0).optional().openapi({
    description:
      "The monthly payment to simulate, in milliunits; default the loan's current payment (the paired category's target, else the minimum payment)",
  }),
  extra_once: Milliunits.min(0).optional().openapi({
    description:
      "A one-time extra payment in milliunits, applied at the start of the current month; default 0",
  }),
};
export const LoanPayoffSimulationRequest = z
  .object(loanPayoffSimulationFields)
  .strict()
  .openapi("LoanPayoffSimulationRequest");

const Point = z.object({ month: z.string(), balance: Milliunits });

export const LoanPayoffSimulation = z
  .object({
    payment_used: Milliunits.nullable().openapi({
      description: "The loan's current monthly payment (the as-is baseline); null without one",
    }),
    monthly_payment: Milliunits.openapi({ description: "The simulated monthly payment" }),
    extra_once: Milliunits,
    payoff_month: z.string().nullable().openapi({ description: "Null when it never pays off" }),
    payments_remaining: z.number().int().nullable(),
    interest_total: Milliunits.openapi({ description: "Interest over the simulation" }),
    principal: Milliunits.openapi({ description: "The remaining balance" }),
    remaining_to_pay: Milliunits.openapi({ description: "principal + interest_total" }),
    interest_savings: Milliunits.nullable().openapi({
      description: "As-is interest minus simulated; null when either never pays off",
    }),
    months_saved: z.number().int().nullable(),
    schedule: z.array(Point).openapi({ description: "The Simulation series" }),
    current: z
      .object({
        payoff_month: z.string().nullable(),
        payments_remaining: z.number().int().nullable(),
        interest_remaining: Milliunits,
        schedule: z.array(Point),
      })
      .openapi({ description: "The loan as it is (the summary's projection)" }),
  })
  .openapi("LoanPayoffSimulation");
export type LoanPayoffSimulation = z.infer<typeof LoanPayoffSimulation>;
export const LoanPayoffSimulationResponse = dataEnvelope(LoanPayoffSimulation);
