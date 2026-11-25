import { z } from "@hono/zod-openapi";
import { IsoDate, Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

// EXF-540: a loan's Account Activity for one month, and the copy of Record Payment.

const State = z.enum(["estimated", "edited", "reconciled"]).openapi({
  description:
    "estimated: computed from the payments; edited: a stored line that is not reconciled; reconciled: a stored line frozen by a balance update",
});

export const LoanPayment = z
  .object({
    transaction_id: z.string(),
    date: IsoDate,
    amount: Milliunits.openapi({ description: "The payment, positive" }),
    memo: z.string().nullable(),
    cleared: z.enum(["uncleared", "cleared", "reconciled"]),
    from_account_id: z.string().nullable(),
    from_account_name: z.string().nullable(),
  })
  .openapi("LoanPayment");

export const LoanInterestLine = z
  .object({
    amount: Milliunits.openapi({ description: "Interest booked this month, negative" }),
    state: State,
    estimated_total: Milliunits.openapi({
      description: "The month's whole estimated interest, negative",
    }),
    still_due: Milliunits.openapi({
      description: "Estimated interest the payments did not cover, a magnitude >= 0",
    }),
  })
  .openapi("LoanInterestLine");

export const LoanEscrowLine = z
  .object({ amount: Milliunits.openapi({ description: "Escrow booked, negative" }), state: State })
  .openapi("LoanEscrowLine");

export const LoanOtherRow = z
  .object({
    transaction_id: z.string(),
    date: IsoDate,
    amount: Milliunits,
    label: z.string().openapi({
      description: 'The payee name, or "Initial Balance" for the Starting Balance row',
    }),
    memo: z.string().nullable(),
  })
  .openapi("LoanOtherRow");

export const LoanActivity = z
  .object({
    month: Month,
    ending_balance: Milliunits.openapi({
      description: "The loan's balance at the end of the month",
    }),
    principal: Milliunits.openapi({
      description: "The part of this month's payments applied to principal",
    }),
    payments: z.array(LoanPayment),
    interest: LoanInterestLine.nullable().openapi({
      description: "null when the month has no payment and no stored interest line",
    }),
    escrow: LoanEscrowLine.nullable().openapi({
      description: "null for a loan that books no escrow, or a month without a payment",
    }),
    other: z.array(LoanOtherRow),
    last_payment_from_account_id: z.string().nullable().openapi({
      description:
        "The source of the loan's latest payment when it is still an open on-plan cash account; Record Payment preselects it",
    }),
  })
  .openapi("LoanActivity");
export type LoanActivity = z.infer<typeof LoanActivity>;

export const LoanActivityResponse = dataEnvelope(LoanActivity);
export const LoanActivityQuery = z.object({ month: Month.optional() }).openapi("LoanActivityQuery");

// Copy, shared by the web view and the tests. `fmt` formats a magnitude.
export const NO_PAYMENTS_TEXT = "No payments this month";
export const ESCROW_NOTE = "Set aside by your lender";
export const LOAN_PAYMENT_SOURCE_TEXT =
  "Pay a loan from an on-plan cash account (checking, savings or cash)";
export const NOT_A_LOAN_TEXT = (name: string) => `${name} is not a loan account`;
export const AMOUNT_REQUIRED_TEXT = (name: string) =>
  `${name} has no paired category with money available to pay; send an amount`;

const MONTHS = [
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
const dayLabel = (date: string) =>
  `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

export function interestNote(
  line: Pick<z.infer<typeof LoanInterestLine>, "state" | "still_due" | "estimated_total">,
  fmt: (magnitude: number) => string,
): string {
  if (line.state === "reconciled") return "Reconciled";
  if (line.state === "edited") return "Edited";
  return line.still_due > 0
    ? `Estimated, ${fmt(line.still_due)} still due (${fmt(Math.abs(line.estimated_total))} total this month)`
    : "Estimated";
}

export const escrowNote = (line: Pick<z.infer<typeof LoanEscrowLine>, "state">): string =>
  line.state === "reconciled" ? "Reconciled" : line.state === "edited" ? "Edited" : ESCROW_NOTE;

export function paymentLine(
  p: Pick<z.infer<typeof LoanPayment>, "amount" | "date" | "memo" | "from_account_name">,
  fmt: (magnitude: number) => string,
): string {
  const base = `${fmt(Math.abs(p.amount))} from ${p.from_account_name ?? "an account"} on ${dayLabel(p.date)}`;
  return p.memo ? `${base}: ${p.memo}` : base;
}

export function otherLine(
  o: Pick<z.infer<typeof LoanOtherRow>, "amount" | "date" | "label">,
  fmt: (magnitude: number) => string,
): string {
  return `${o.amount < 0 ? "-" : ""}${fmt(Math.abs(o.amount))} ${o.label} on ${dayLabel(o.date)}`;
}

export const RECORD_PAYMENT_TITLE = "Record Payment";
export const RECORD_PAYMENT_INTRO_PAIRED =
  "Record a payment you made to this loan. It will appear in the paired account, and the payment is applied to escrow, interest and principal.";
export const RECORD_PAYMENT_INTRO_LOAN =
  "Record a payment you made to this loan. It will appear here, and Budget will estimate the escrow, interest and principal it covers.";
export const RECORD_PAYMENT_AVAILABLE = (amount: string, category: string) =>
  `You have ${amount} available for payment in ${category}.`;
export const RECORD_PAYMENT_AMOUNT_HELP =
  "Budget will estimate the interest and escrow from this payment; the rest is applied to principal.";
export const RECORD_PAYMENT_LABELS = {
  amount: "Payment Amount",
  from: "From Account",
  date: "Date",
  memo: "Memo",
  cancel: "Cancel",
  save: "Save",
} as const;
