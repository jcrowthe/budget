import { z } from "@hono/zod-openapi";
import { PlanDate } from "./accounts";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { Transaction } from "./transactions";

// EXF-542: a loan's Add Activity write (interest, fee, credit) and the copy of its menu and dialogs.
// docs/loan-add-activity-design.md. "Budget" is where the source app names itself.

export const ADD_ACTIVITY_KINDS = ["interest", "fee", "credit", "escrow"] as const;

export const loanAddActivityFields = {
  kind: z.enum(ADD_ACTIVITY_KINDS).openapi({
    description:
      "interest: recorded interest on a month, added to what is there (a stored, edited interest line); fee: a charge against the loan (balance goes more negative); credit: a credit or refund (balance goes up); escrow: the month's known escrow, mortgage only (the amount is the month's total, replacing any estimated or recorded escrow that is not reconciled)",
  }),
  amount: Milliunits.positive().openapi({
    description:
      "The amount, a magnitude > 0; the kind gives the sign (5000000 for 5,000.00). For escrow it is the month's total escrow",
  }),
  month: Month.optional().openapi({
    description:
      "interest and escrow only: the month the line belongs to; default the month of today; a month after today's is refused (future_month)",
  }),
  date: PlanDate.optional().openapi({
    description: "fee and credit only: the row's date (YYYY-MM-DD); default today",
  }),
  memo: z.string().max(500).nullable().optional().openapi({
    description: "fee and credit only: the row's memo",
  }),
  today: PlanDate.optional().openapi({
    description:
      "The caller's date (YYYY-MM-DD): the default month and date, and the interest or escrow row's date in today's month; default the UTC date",
  }),
};

export const LoanAddActivityRequest = z
  .object(loanAddActivityFields)
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "interest" || v.kind === "escrow") {
      if (v.date !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: `date does not apply to ${v.kind}`,
        });
      }
      if (v.memo !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["memo"],
          message: `memo does not apply to ${v.kind}`,
        });
      }
    } else if (v.month !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["month"],
        message: `month applies to interest and escrow only, not to a ${v.kind}`,
      });
    }
  })
  .openapi("LoanAddActivityRequest");
export type LoanAddActivityRequest = z.input<typeof LoanAddActivityRequest>;

export const LoanAddActivityResult = z
  .object({
    kind: z.enum(ADD_ACTIVITY_KINDS),
    transaction: Transaction,
    balance: Milliunits.openapi({ description: "The loan's balance after the write" }),
  })
  .openapi("LoanAddActivityResult");
export type LoanAddActivityResult = z.infer<typeof LoanAddActivityResult>;
export const LoanAddActivityResponse =
  dataEnvelope(LoanAddActivityResult).openapi("LoanAddActivityResponse");

export const FUTURE_MONTH_TEXT = "Interest cannot be recorded for a month that has not begun";
export const FUTURE_ESCROW_MONTH_TEXT = "Escrow cannot be recorded for a month that has not begun";
export const ESCROW_MORTGAGE_ONLY_TEXT = "Escrow applies to a mortgage only";

// Labels of a payee-less row in Other Activity (D5).
export const FEE_LABEL = "Fee or Charge";
export const CREDIT_LABEL = "Credit";

export const ADD_ACTIVITY_LABEL = "Add Activity";
export type AddActivityId = "payment" | "credit" | "fee" | "interest" | "escrow";
export const ADD_ACTIVITY_ITEMS: readonly { id: AddActivityId; label: string; subtitle: string }[] =
  [
    { id: "payment", label: "Add Payment", subtitle: "For payments to reduce your balance" },
    { id: "credit", label: "Add Credit", subtitle: "For credits or refunds to your account" },
    {
      id: "fee",
      label: "Add Fee or Charge",
      subtitle: "For late fees, annual fees, or withdrawals",
    },
    { id: "interest", label: "Add Interest", subtitle: "For recording known interest accrual" },
    { id: "escrow", label: "Add Escrow", subtitle: "For recording a known escrow amount" },
  ];

export const RECORD_INTEREST = {
  title: "Record Interest",
  text: "Interest recorded will be in addition to any existing estimated or recorded interest in the chosen month.",
  labels: { amount: "Interest Amount", month: "Month", cancel: "Cancel", save: "Save" },
} as const;

export const RECORD_ESCROW = {
  title: "Record Escrow",
  text: "The amount entered becomes the escrow for the chosen month, replacing any estimated or recorded escrow that is not reconciled.",
  labels: { amount: "Escrow Amount", month: "Month", cancel: "Cancel", save: "Save" },
} as const;

export const RECORD_CHARGE = {
  title: "Record New Charge",
  texts: [
    "This is for charges against your account other than interest or escrow: new withdrawals, late fees, annual fees, etc.",
    "Remember to set additional money aside in your plan for payment if you do not want these new charges to carry forward as increased debt.",
  ],
  labels: { amount: "Amount", date: "Date", memo: "Memo", cancel: "Cancel", save: "Save" },
} as const;

export const RECORD_CREDIT = {
  title: "Record Credit or Refund",
  texts: [
    "This is for credits or refunds to your account, other than payments.",
    "This amount will be credited towards your account balance, but will not be included in Ready to Assign or in your plan category balance.",
  ],
  labels: { amount: "Amount", date: "Date", memo: "Memo", cancel: "Cancel", save: "Save" },
} as const;
