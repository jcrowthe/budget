import { z } from "@hono/zod-openapi";
import { PlanDate } from "./accounts";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { ADD_ACTIVITY_KINDS } from "./loan-add-activity";
import { Transaction } from "./transactions";

// Loan manage: edit or delete a recorded interest, escrow, fee or credit line. docs/loan-manage-design.md.

export const loanActivityPatchFields = {
  amount: Milliunits.positive().optional().openapi({
    description:
      "The new amount, a magnitude > 0 (the row keeps its kind and sign). For an interest or escrow line it is the line's whole magnitude, as Account Activity shows it; for a payment both sides change",
  }),
  date: PlanDate.optional().openapi({
    description:
      "fee, credit and payment only: the row's new date (YYYY-MM-DD); it may move to another month",
  }),
  memo: z.string().max(500).nullable().optional().openapi({
    description: "fee, credit and payment only: the row's memo; null clears it",
  }),
  today: PlanDate.optional().openapi({
    description:
      "interest and escrow only: the caller's date (YYYY-MM-DD), the edited row's date in today's month; default the UTC date",
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

export const LOAN_ACTIVITY_CHANGE_KINDS = [...ADD_ACTIVITY_KINDS, "payment"] as const;

export const LoanActivityChangeResult = z
  .object({
    kind: z.enum(LOAN_ACTIVITY_CHANGE_KINDS),
    transaction: Transaction.nullable().openapi({
      description: "The row written, as get_transaction returns it; null after a delete",
    }),
    from_transaction: Transaction.nullable().optional().openapi({
      description:
        "payment only: the cash account's side after the write, as get_transaction returns it; null after a delete; absent for other kinds",
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
export const ESCROW_BELOW_RECONCILED_TEXT = (reconciled: string) =>
  `Escrow this month can't be less than its reconciled ${reconciled}`;
export const NOT_EDITABLE_ACTIVITY_TEXT =
  "Only a recorded interest or escrow line, a fee, a credit or a payment can be edited or deleted here";
export const PAYMENT_RECONCILED_TEXT = (name: string) =>
  `This payment is reconciled in ${name} and can't be changed`;
export const PAYMENT_OTHER_CLOSED_TEXT = "The other account of this payment is closed";
export const TODAY_NOT_FOR_PAYMENT_TEXT = "today does not apply to a payment";

// Copy of the edit dialog.
export const EDIT_INTEREST_TITLE = "Edit Interest";
export const EDIT_ESCROW_TITLE = "Edit Escrow";
export const EDIT_FEE_TITLE = "Edit Fee or Charge";
export const EDIT_CREDIT_TITLE = "Edit Credit";
export const EDIT_PAYMENT_TITLE = "Edit Payment";
export const PAYMENT_FROM_LABEL = (name: string) => `From ${name}`;
export const DELETE_PAYMENT_TITLE = "Delete this payment?";
export const DELETE_PAYMENT_BODY = (name: string) => `It is also removed from ${name}.`;
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
