import { z } from "@hono/zod-openapi";
import { Account, InterestRate, PlanDate } from "./accounts";
import { IsoDateTime } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { Transaction } from "./transactions";

// EXF-543: a loan's Update Balance write and the copy of its wizard. docs/loan-update-balance-design.md.

export const BALANCE_ADJUSTMENT_LABEL = "Balance adjustment";
export const LOAN_INTEREST_PAYEE = "Loan Interest";
export const LOAN_ESCROW_PAYEE = "Loan Escrow";
export const NOT_YET_UPDATED = "Not Yet Updated";

export const loanBalanceUpdateFields = {
  balance: Milliunits.openapi({
    description:
      "The balance at the lender, signed like the account balance (-199500000 for 199,500.00 owed)",
  }),
  interest_rate: InterestRate.optional().openapi({
    description: "The rate to freeze this month's interest at; default the stored rate",
  }),
  escrow_amount: Milliunits.min(0).optional().openapi({
    description:
      "Mortgages only: the escrow to freeze this month's escrow at; default the stored one",
  }),
  keep_rate: z.boolean().default(true).openapi({
    description: "Store interest_rate on the loan going forward (default true)",
  }),
  keep_escrow: z.boolean().default(true).openapi({
    description: "Store escrow_amount on the loan going forward (default true)",
  }),
  current_balance: Milliunits.optional().openapi({
    description:
      "The balance the caller saw and confirmed; a different one answers 409 balance_changed and writes nothing",
  }),
  today: PlanDate.optional().openapi({
    description:
      "The update's date (YYYY-MM-DD): its month is the last one frozen; default the UTC date",
  }),
  preview: z.boolean().default(false).openapi({
    description: "Compute the answer and write nothing (default false)",
  }),
};
export const LoanBalanceUpdateRequest = z
  .object(loanBalanceUpdateFields)
  .strict()
  .openapi("LoanBalanceUpdateRequest");
export type LoanBalanceUpdateRequest = z.input<typeof LoanBalanceUpdateRequest>;

export const LoanBalanceUpdateResult = z
  .object({
    adjustment_amount: Milliunits.openapi({
      description: "The balance adjustment written (or to be written, in a preview); 0 for none",
    }),
    previous_balance: Milliunits.openapi({ description: "The account balance before the update" }),
    balance: Milliunits.openapi({ description: "The account balance after the update" }),
    balance_updated_at: IsoDateTime.nullable(),
    account: Account,
    adjustment: Transaction.nullable(),
  })
  .openapi("LoanBalanceUpdateResult");
export type LoanBalanceUpdateResult = z.infer<typeof LoanBalanceUpdateResult>;
export const LoanBalanceUpdateResponse = dataEnvelope(LoanBalanceUpdateResult).openapi(
  "LoanBalanceUpdateResponse",
);

// The wizard's copy ("Budget" where the source app names itself).
export const UPDATE_BALANCE_ASK = (amount: string) =>
  `Is your current balance at your lender ${amount} ?`;
export const UPDATE_BALANCE_DIFFERENCE_TEXT =
  "The balance recorded in Budget doesn't match your account. Update your interest rate and escrow below, then Budget will add a balance adjustment for what remains.";
export const UPDATE_BALANCE_CHANGES_TEXT =
  "The difference between your account balance in Budget and at your lender will be recorded as a balance adjustment.";
export const UPDATE_BALANCE_DONE_TITLE =
  "Your balance has been updated! Time for the reconciliation dance.";
export const UPDATE_BALANCE_DONE_TEXT =
  "Remember to update your balance before making a payment to get the most accurate information.";
