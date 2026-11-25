import { z } from "@hono/zod-openapi";
import { Account } from "./accounts";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { durationText } from "./debt-target";

// EXF-541: a loan's summary (tiles, payoff, progress chart, paired category) and the pairing write, and their copy.

const Point = z
  .object({
    month: Month,
    balance: Milliunits.openapi({ description: "The balance owed, a magnitude >= 0" }),
  })
  .openapi("LoanBalancePoint");

const TargetFigures = z
  .object({
    amount: Milliunits,
    type: z.literal("debt_payment").nullable().openapi({
      description:
        "debt_payment: the paired category's Debt Payment Target (a monthly set-aside); null for any other target",
    }),
    cadence: z.enum(["weekly", "monthly", "yearly", "custom"]),
    behavior: z.enum(["set_aside", "refill", "fill_up", "balance"]),
    day_of_month: z.number().int().nullable(),
    due_date: z.string().nullable(),
    needed_this_month: Milliunits,
  })
  .openapi("LoanPairedTarget");

export const LoanPairedCategory = z
  .object({
    id: z.string(),
    name: z.string(),
    group_name: z.string(),
    available: Milliunits.openapi({ description: "The category's Available in the month" }),
    target: TargetFigures.nullable(),
  })
  .openapi("LoanPairedCategory");

export const LoanSummary = z
  .object({
    remaining_balance: Milliunits.openapi({
      description: "What is owed now, a magnitude >= 0 (the account balance, negated)",
    }),
    original_balance: Milliunits.nullable().openapi({
      description: "The magnitude of the Starting Balance rows; null for a loan without one",
    }),
    percent_remaining: z.number().nullable().openapi({
      description: "remaining / original x 100, one decimal; null without an original balance",
    }),
    interest_rate: z.string().nullable(),
    minimum_payment: Milliunits.nullable(),
    escrow_amount: Milliunits.nullable().openapi({ description: "Mortgages only; else null" }),
    payment_used: Milliunits.nullable().openapi({
      description: "The monthly payment the projection uses; null without a minimum payment",
    }),
    payment_source: z.enum(["target", "minimum"]).nullable().openapi({
      description:
        "target: the paired category's monthly target; minimum: the loan's minimum payment",
    }),
    payoff_month: Month.nullable().openapi({
      description: "The month plus payments_remaining; null when it never pays off",
    }),
    payments_remaining: z.number().int().nullable(),
    interest_remaining: Milliunits.openapi({
      description: "Interest over the projection, a magnitude; 0 when it never pays off",
    }),
    schedule: z.array(Point).openapi({
      description: "The Current Track: [{month, balance}] from the month to 0 at the payoff month",
    }),
    history: z
      .array(Point)
      .openapi({ description: "Month-end balances up to the month (Past Balance)" }),
    original_schedule: z.array(Point).openapi({
      description: "The Original Payment Schedule; empty without an original balance",
    }),
    paired_category: LoanPairedCategory.nullable(),
    balance_updated_at: z.string().nullable().openapi({
      description: "The account's last reconcile time; null = never",
    }),
  })
  .openapi("LoanSummary");
export type LoanSummary = z.infer<typeof LoanSummary>;

export const LoanSummaryResponse = dataEnvelope(LoanSummary);
export const LoanSummaryQuery = z.object({ month: Month.optional() }).openapi("LoanSummaryQuery");

export const LoanPairingRequest = z
  .object({ category_id: z.string().min(1) })
  .strict()
  .openapi("LoanPairingRequest");
export type LoanPairingRequest = z.infer<typeof LoanPairingRequest>;
export const LoanPairingResponse = dataEnvelope(z.object({ account: Account }));

export const UNPAIRABLE_CATEGORY_TEXT =
  "paired_category_id must be an active, visible category of this plan that is not a payment category";

// ---- copy ----

export const DASH = "—";
export const PAST_BALANCE_TIP = "Your loan's balance at the end of each past month";
export const ORIGINAL_SCHEDULE_TIP =
  "Estimated balance based on paying the minimum since the start of the loan. You can change the starting point by clicking into any Past Balance in the chart.";
export const CURRENT_TRACK_TIP =
  "Estimated future balance if you pay the minimum required amount due per payment period.";
export const CURRENT_TRACK_TARGET_TIP =
  "Estimated future balance if you pay your paired category’s target amount every payment period.";
export const PROMO_TITLE = "Make a plan to crush your debts with the loan payoff simulator";
export const PROMO_BODY = "Find out how to save money and achieve your goals faster.";
export const UNPAIRED_TITLE = "Pair your loan and get more out of your plan";
export const UNPAIRED_BODY =
  "Pairing your loan with a plan category helps you better keep track of your payments in your plan.";

export function rateLabel(rate: string | null): string {
  return rate === null || rate.trim() === "" ? DASH : `${rate.trim()}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2056-11-01" -> "Nov 2056". */
export function payoffLabel(month: string | null): string {
  if (month === null) return DASH;
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
}

export { durationText };

/** "Balance Remaining $200,000 (100.0%)": `whole` is the plan formatter's money without decimals. */
export function progressLine(
  remaining: number,
  percent: number | null,
  whole: (milliunits: number) => string,
): string {
  const base = `Balance Remaining ${whole(remaining)}`;
  return percent === null ? base : `${base} (${percent.toFixed(1)}%)`;
}

export type Segment = { text: string; bold?: boolean };

/** The sentence under the chart, in segments so the amount and the duration can be bold. */
export function trackSentence(
  v: { source: "target" | "minimum"; payment: number; n: number | null },
  money: (milliunits: number) => string,
): Segment[] {
  if (v.n === 0) return [{ text: "This loan is paid off" }];
  const lead = v.source === "target" ? "Your monthly target of " : "The minimum payment of ";
  const amount = { text: money(v.payment), bold: true };
  if (v.n === null) return [{ text: lead }, amount, { text: " won't pay off this loan" }];
  const mid =
    v.source === "target"
      ? " keeps you on track to pay off this loan in "
      : " will pay off this loan in ";
  return [{ text: lead }, amount, { text: mid }, { text: durationText(v.n), bold: true }];
}
