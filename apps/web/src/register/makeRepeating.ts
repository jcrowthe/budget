import { formatEntryDate } from "@budget/schema/date-entry";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import { occurrenceAfter } from "@budget/schema/recurrence";
import type { TransactionDetail } from "@budget/schema/transactions";
import { type Draft, draftFromTx } from "./entryDraft";

type Row = TransactionDetail;

/** Shown by Make Repeating's menu item for a transfer (a split can repeat since EXF-501 part 2). */
export const REPEAT_TRANSFER = "Make Repeating isn't available for transfers yet.";
export const REPEAT_ON_SCHEDULED =
  "Make Repeating works on a recorded transaction, not on a scheduled one";
export const REPEAT_SELECT_ONE = "Select one transaction to make it repeating";
export const REPEAT_SYSTEM_PAYEE = "Starting balances, adjustments and loan interest can't repeat";
export const REPEAT_CLOSED = "A closed account takes no new transactions";

export type MakeRepeatingState =
  | { enabled: true; source: Row }
  | { enabled: false; reason: string };

/** Whether Make Repeating works for this selection, and the reason it does not. First match wins. */
export function makeRepeatingState(input: {
  real: readonly Row[];
  scheduledCount: number;
  accountClosed: (accountId: string) => boolean;
}): MakeRepeatingState {
  const { real, scheduledCount, accountClosed } = input;
  const off = (reason: string): MakeRepeatingState => ({ enabled: false, reason });
  if (scheduledCount > 0) return off(REPEAT_ON_SCHEDULED);
  const [source] = real;
  if (real.length !== 1 || !source) return off(REPEAT_SELECT_ONE);
  if (source.transfer_account_id) return off(REPEAT_TRANSFER);
  if (source.payee_system !== null) return off(REPEAT_SYSTEM_PAYEE);
  if (accountClosed(source.account_id)) return off(REPEAT_CLOSED);
  return { enabled: true, source };
}

/**
 * The add row's first draft for a new series made from `tx`: the same account, payee, category (or split lines, with
 * fresh keys), memo and amount, dated one month after the original (clamped to the month's end), repeating monthly. The flag and the cleared
 * state are not carried over.
 */
export function draftForRepeat(tx: Row, fmt: PlanFormatter): Draft {
  const next = occurrenceAfter(tx.date, "monthly", tx.date) ?? tx.date;
  return {
    ...draftFromTx(tx, fmt),
    transferAccountId: null,
    cleared: "uncleared",
    frequency: "monthly",
    dateText: formatEntryDate(next, fmt),
    lastDate: next,
  };
}
