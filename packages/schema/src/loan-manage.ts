import { z } from "@hono/zod-openapi";
import { PlanDate } from "./accounts";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { ADD_ACTIVITY_KINDS } from "./loan-add-activity";
import { Transaction } from "./transactions";

// Loan manage: edit or delete a recorded interest, fee or credit line. docs/loan-manage-design.md.

export const loanActivityPatchFields = {
  amount: Milliunits.positive().optional().openapi({
    description:
      "The new amount, a magnitude > 0 (the row keeps its kind and sign). For an interest line it is the line's whole magnitude, as Account Activity shows it",
  }),
  date: PlanDate.optional().openapi({
    description:
      "fee and credit only: the row's new date (YYYY-MM-DD); it may move to another month",
  }),
  memo: z.string().max(500).nullable().optional().openapi({
    description: "fee and credit only: the row's memo; null clears it",
  }),
  today: PlanDate.optional().openapi({
    description:
      "interest only: the caller's date (YYYY-MM-DD), the edited row's date in today's month; default the UTC date",
  }),
};

export const LoanActivityPatchRequest = z
  .object(loanActivityPatchFields)
  .strict()
  .refine((v) => v.amount !== undefined || v.date !== undefined || v.memo !== undefined, {
    message: "send at least one of amount, date and memo",
  })
  .openapi("LoanActivityPatchRequest");
export type LoanActivityPatchRequest = z.input<typeof LoanActivityPatchRequest>;

export const LoanActivityChangeResult = z
  .object({
    kind: z.enum(ADD_ACTIVITY_KINDS),
    transaction: Transaction.nullable().openapi({
      description: "The row written, as get_transaction returns it; null after a delete",
    }),
    balance: Milliunits.openapi({ description: "The loan's balance after the write" }),
  })
  .openapi("LoanActivityChangeResult");
export type LoanActivityChangeResult = z.infer<typeof LoanActivityChangeResult>;
export const LoanActivityChangeResponse = dataEnvelope(LoanActivityChangeResult).openapi(
  "LoanActivityChangeResponse",
);

export const INTEREST_BELOW_RECONCILED_TEXT = (reconciled: string) =>
  `Interest this month can't be less than its reconciled ${reconciled}`;
export const NOT_EDITABLE_ACTIVITY_TEXT =
  "Only a recorded interest line, a fee or a credit can be edited or deleted here";

// Copy of the edit dialog.
export const EDIT_INTEREST_TITLE = "Edit Interest";
export const EDIT_FEE_TITLE = "Edit Fee or Charge";
export const EDIT_CREDIT_TITLE = "Edit Credit";
export const DELETE_LINE_TITLE = "Delete this line?";
export const DELETE_LINE_BODY = "The loan's balance changes with it. Undo brings the line back.";
export const EDIT_ACTIVITY_LABELS = {
  amount: "Amount",
  date: "Date",
  memo: "Memo",
  month: "Month",
  delete: "Delete",
  cancel: "Cancel",
  save: "Save",
} as const;
