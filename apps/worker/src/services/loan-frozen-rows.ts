import { type LOAN_ESCROW_SYSTEM, LOAN_INTEREST_SYSTEM } from "@budget/core/loan-engine";
import type { Month } from "@budget/core/month";
import { LOAN_ESCROW_PAYEE, LOAN_INTEREST_PAYEE } from "@budget/schema/loan-balance-update";
import type { TransactionRow } from "../repositories/transactions";

// EXF-543 and EXF-542: the stored interest and escrow rows the loan engine reads as frozen. Update Balance writes
// them reconciled; Add Interest writes them cleared (so the line reads edited). One builder, so the two cannot drift.

export const utcToday = () => new Date().toISOString().slice(0, 10);
export const monthOf = (date: string): Month => `${date.slice(0, 7)}-01`;
export const lastDayOf = (month: Month): string =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

/** The date of a new frozen row: `today` in today's month, the month's last day before it. */
export const frozenRowDate = (month: Month, today: string): string =>
  month === monthOf(today) ? today : lastDayOf(month);

/** The row of a frozen interest or escrow line: its system payee and name, no category, not to Ready to Assign. */
export function frozenLoanRow(o: {
  budgetId: string;
  accountId: string;
  payeeId: string;
  system: typeof LOAN_INTEREST_SYSTEM | typeof LOAN_ESCROW_SYSTEM;
  date: string;
  amount: number;
  cleared: "cleared" | "reconciled";
  now: string;
  id?: string;
}): TransactionRow {
  return {
    id: o.id ?? crypto.randomUUID(),
    budgetId: o.budgetId,
    accountId: o.accountId,
    date: o.date,
    payeeId: o.payeeId,
    payeeName: o.system === LOAN_INTEREST_SYSTEM ? LOAN_INTEREST_PAYEE : LOAN_ESCROW_PAYEE,
    categoryId: null,
    inflowToReadyToAssign: false,
    memo: null,
    amount: o.amount,
    cleared: o.cleared,
    approved: true,
    createdAt: o.now,
    deletedAt: null,
    updatedAt: o.now,
  };
}
