import { evaluateAmountEntry, formatAmountEntry, signedAmount } from "@budget/schema/amount-entry";
import { formatEntryDate, parseEntryDate } from "@budget/schema/date-entry";
import type {
  TransactionCreateRequest,
  TransactionDetail,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";

export type Field = "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow";

/** What the register has open: nothing, a new row, or one row being edited. */
export type Open =
  | null
  | { mode: "add"; key: number; date?: string }
  | { mode: "edit"; id: string; focus: Field; openCategory?: boolean };

export type CategoryValue = { kind: "none" } | { kind: "rta" } | { kind: "category"; id: string };

export type Draft = {
  accountId: string | null;
  dateText: string;
  /** The last date that parsed, for the date keys when the text is not a date. */
  lastDate: string;
  payee: { id: string | null; name: string };
  category: CategoryValue;
  memo: string;
  outflowText: string;
  inflowText: string;
  cleared: "uncleared" | "cleared";
};

export function emptyDraft(date: string, accountId: string | null): Draft {
  return {
    accountId,
    dateText: formatEntryDate(date),
    lastDate: date,
    payee: { id: null, name: "" },
    category: { kind: "none" },
    memo: "",
    outflowText: "",
    inflowText: "",
    cleared: "uncleared",
  };
}

export function draftFromTx(tx: TransactionDetail): Draft {
  return {
    accountId: tx.account_id,
    dateText: formatEntryDate(tx.date),
    lastDate: tx.date,
    payee: { id: tx.payee_id, name: tx.payee_name ?? "" },
    category: tx.category_id
      ? { kind: "category", id: tx.category_id }
      : tx.inflow_to_ready_to_assign
        ? { kind: "rta" }
        : { kind: "none" },
    memo: tx.memo ?? "",
    outflowText: tx.amount < 0 ? formatAmountEntry(-tx.amount) : "",
    inflowText: tx.amount > 0 ? formatAmountEntry(tx.amount) : "",
    cleared: tx.cleared === "cleared" ? "cleared" : "uncleared",
  };
}

export function draftAmount(d: Draft): number {
  return signedAmount(evaluateAmountEntry(d.outflowText), evaluateAmountEntry(d.inflowText));
}

const categoryFields = (c: CategoryValue) => ({
  category_id: c.kind === "category" ? c.id : null,
  inflow_to_ready_to_assign: c.kind === "rta",
});

const payeeFields = (p: Draft["payee"]) =>
  p.id
    ? { payee_id: p.id }
    : p.name.trim() === ""
      ? { payee_id: null }
      : { payee_name: p.name.trim() };

export type DraftError = { field: Field; message: string } | null;

/** The date and account checks that stop a save; nothing else does. */
export function draftError(d: Draft, today: string, needAccount: boolean): DraftError {
  if (needAccount && !d.accountId) return { field: "account", message: "Choose an account." };
  if (!parseEntryDate(d.dateText, today)) {
    return { field: "date", message: "Enter a date like 11/15/2026." };
  }
  return null;
}

export function draftToCreate(
  d: Draft,
  accountId: string,
  today: string,
): TransactionCreateRequest {
  const date = parseEntryDate(d.dateText, today) as string;
  const memo = d.memo.trim();
  const payee = payeeFields(d.payee);
  return {
    account_id: accountId,
    date,
    amount: draftAmount(d),
    cleared: d.cleared,
    approved: true,
    ...(memo ? { memo } : {}),
    ...("payee_id" in payee && payee.payee_id === null ? {} : payee),
    ...(d.category.kind === "none" ? {} : categoryFields(d.category)),
  };
}

/** Only the fields that differ from the row as it was opened. */
export function draftToPatch(
  before: TransactionDetail,
  d: Draft,
  today: string,
): TransactionUpdateRequest {
  const was = draftFromTx(before);
  const patch: TransactionUpdateRequest = {};
  const date = parseEntryDate(d.dateText, today) as string;
  if (date !== before.date) patch.date = date;
  if (d.accountId && d.accountId !== before.account_id) patch.account_id = d.accountId;
  const payeeChanged = d.payee.id
    ? d.payee.id !== before.payee_id
    : d.payee.name.trim() !== (before.payee_name ?? "");
  if (payeeChanged) Object.assign(patch, payeeFields(d.payee));
  if (JSON.stringify(d.category) !== JSON.stringify(was.category)) {
    Object.assign(patch, categoryFields(d.category));
  }
  if (d.memo.trim() !== (before.memo ?? ""))
    patch.memo = d.memo.trim() === "" ? null : d.memo.trim();
  const amount = draftAmount(d);
  if (amount !== before.amount) patch.amount = amount;
  if (d.cleared !== was.cleared) patch.cleared = d.cleared;
  return patch;
}
