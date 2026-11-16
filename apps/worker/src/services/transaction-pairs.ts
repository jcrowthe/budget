import { transferPayeeName } from "@budget/schema/transfers";
import type { TransactionRow } from "../repositories/transactions";

/** The columns of a transfer's other side that follow this side. */
export function mirror(self: TransactionRow, other: TransactionRow): TransactionRow {
  return {
    ...other,
    date: self.date,
    memo: self.memo,
    // `0 - x` keeps zero positive.
    amount: 0 - self.amount,
    approved: self.approved || other.approved,
    transferAccountId: self.accountId,
    transferTransactionId: self.id,
  };
}

/** A fresh other side for `self`: opposite amount, same date and memo, uncleared, linked back. */
export function newOtherSide(
  self: TransactionRow,
  otherAccountId: string,
  selfAccountName: string,
  now: string,
): TransactionRow {
  return mirror(self, {
    id: crypto.randomUUID(),
    budgetId: self.budgetId,
    accountId: otherAccountId,
    date: self.date,
    payeeId: null,
    payeeName: transferPayeeName(selfAccountName),
    categoryId: null,
    inflowToReadyToAssign: false,
    memo: self.memo,
    amount: 0 - self.amount,
    cleared: "uncleared",
    approved: true,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  });
}

/** True when the other side already has what `mirror` would write. */
export function sameSide(a: TransactionRow, b: TransactionRow): boolean {
  return (
    a.accountId === b.accountId &&
    a.date === b.date &&
    a.memo === b.memo &&
    a.approved === b.approved &&
    a.amount === b.amount &&
    a.categoryId === b.categoryId &&
    a.inflowToReadyToAssign === b.inflowToReadyToAssign &&
    (a.transferAccountId ?? null) === (b.transferAccountId ?? null) &&
    (a.transferTransactionId ?? null) === (b.transferTransactionId ?? null)
  );
}
