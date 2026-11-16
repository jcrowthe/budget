import { evaluateAmountEntry, formatAmountEntry, signedAmount } from "@budget/schema/amount-entry";
import { formatEntryDate, parseEntryDate } from "@budget/schema/date-entry";
import type { Payee } from "@budget/schema/payees";
import type { Frequency } from "@budget/schema/recurrence";
import type {
  ScheduledTransaction,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
} from "@budget/schema/scheduled-transactions";
import type {
  SubTransactionInput,
  TransactionCreateRequest,
  TransactionDetail,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";

/** The category a picked payee fills in: its latest one, or Ready to Assign, or nothing. */
export function rememberedCategory(
  p: Pick<Payee, "last_category_id" | "last_inflow_to_ready_to_assign">,
): CategoryValue | null {
  if (p.last_category_id) return { kind: "category", id: p.last_category_id };
  return p.last_inflow_to_ready_to_assign ? { kind: "rta" } : null;
}

export type Field = "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow";

/** What the register has open: nothing, a new row, or one row being edited. */
export type Open =
  | null
  | { mode: "add"; key: number; date?: string }
  | { mode: "edit"; id: string; focus: Field; openCategory?: boolean; split?: true }
  | { mode: "editScheduled"; id: string; focus: Field };

export type CategoryValue = { kind: "none" } | { kind: "rta" } | { kind: "category"; id: string };

/** One line of a split being edited. */
export type LineDraft = {
  key: number;
  payee: { id: string | null; name: string };
  category: CategoryValue;
  memo: string;
  outflowText: string;
  inflowText: string;
};

let lineKey = 0;
export const emptyLine = (): LineDraft => ({
  key: ++lineKey,
  payee: { id: null, name: "" },
  category: { kind: "none" },
  memo: "",
  outflowText: "",
  inflowText: "",
});

export const lineAmount = (l: Pick<LineDraft, "outflowText" | "inflowText">): number =>
  signedAmount(evaluateAmountEntry(l.outflowText), evaluateAmountEntry(l.inflowText));

/** The text of an amount in its column: outflow for a negative one. */
export const amountTexts = (amount: number) => ({
  outflowText: amount < 0 ? formatAmountEntry(-amount) : "",
  inflowText: amount > 0 ? formatAmountEntry(amount) : "",
});

export type Draft = {
  /** The other account of a transfer; the payee text is then "Transfer : <account>". */
  transferAccountId: string | null;
  /** The lines of a split; null for a plain transaction. */
  lines: LineDraft[] | null;
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
  /** The calendar's Repeat select; "never" for a real row. */
  frequency: Frequency;
};

export function emptyDraft(date: string, accountId: string | null): Draft {
  return {
    transferAccountId: null,
    lines: null,
    accountId,
    dateText: formatEntryDate(date),
    lastDate: date,
    payee: { id: null, name: "" },
    category: { kind: "none" },
    memo: "",
    outflowText: "",
    inflowText: "",
    cleared: "uncleared",
    frequency: "never",
  };
}

export function draftFromTx(tx: TransactionDetail): Draft {
  return {
    transferAccountId: tx.transfer_account_id,
    lines: tx.subtransactions.length
      ? tx.subtransactions.map((l) => ({
          key: ++lineKey,
          payee: { id: l.payee_id, name: l.payee_name ?? "" },
          category: l.category_id
            ? { kind: "category", id: l.category_id }
            : l.inflow_to_ready_to_assign
              ? { kind: "rta" }
              : { kind: "none" },
          memo: l.memo ?? "",
          ...amountTexts(l.amount),
        }))
      : null,
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
    frequency: "never",
  };
}

/** A scheduled row opened for editing: its next date and its frequency. */
export function draftFromScheduled(s: ScheduledTransaction): Draft {
  return {
    transferAccountId: null,
    lines: null,
    accountId: s.account_id,
    dateText: formatEntryDate(s.date_next),
    lastDate: s.date_next,
    payee: { id: s.payee_id, name: s.payee_name ?? "" },
    category: s.category_id
      ? { kind: "category", id: s.category_id }
      : s.inflow_to_ready_to_assign
        ? { kind: "rta" }
        : { kind: "none" },
    memo: s.memo ?? "",
    ...amountTexts(s.amount),
    cleared: "uncleared",
    frequency: s.frequency,
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

const linesBody = (lines: LineDraft[]): SubTransactionInput[] =>
  lines.map((l) => {
    const memo = l.memo.trim();
    return {
      amount: lineAmount(l),
      ...(l.payee.id || l.payee.name.trim() !== "" ? payeeFields(l.payee) : {}),
      ...(l.category.kind === "none" ? {} : categoryFields(l.category)),
      ...(memo ? { memo } : {}),
    };
  });

/** Compares lines by what they would send. */
const linesSignature = (lines: LineDraft[] | null) =>
  lines === null
    ? null
    : JSON.stringify(
        lines.map((l) => [
          lineAmount(l),
          l.payee.id ?? l.payee.name.trim(),
          l.category,
          l.memo.trim(),
        ]),
      );

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
    ...(d.transferAccountId
      ? { transfer_account_id: d.transferAccountId }
      : "payee_id" in payee && payee.payee_id === null
        ? {}
        : payee),
    ...(d.category.kind === "none" || d.lines ? {} : categoryFields(d.category)),
    ...(d.lines ? { subtransactions: linesBody(d.lines) } : {}),
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
  if (d.transferAccountId !== was.transferAccountId) {
    // A new or different other account; leaving a transfer sends null with the row's payee.
    patch.transfer_account_id = d.transferAccountId;
  }
  const payeeChanged = d.payee.id
    ? d.payee.id !== before.payee_id
    : d.payee.name.trim() !== (before.payee_name ?? "");
  if (!d.transferAccountId && (payeeChanged || was.transferAccountId)) {
    Object.assign(patch, payeeFields(d.payee));
  }
  if (!d.lines && JSON.stringify(d.category) !== JSON.stringify(was.category)) {
    Object.assign(patch, categoryFields(d.category));
  }
  if (d.memo.trim() !== (before.memo ?? ""))
    patch.memo = d.memo.trim() === "" ? null : d.memo.trim();
  const amount = draftAmount(d);
  if (amount !== before.amount) patch.amount = amount;
  if (d.cleared !== was.cleared) patch.cleared = d.cleared;
  if (
    d.lines &&
    (linesSignature(d.lines) !== linesSignature(was.lines) || amount !== before.amount)
  ) {
    patch.subtransactions = linesBody(d.lines);
    patch.amount = amount;
  } else if (!d.lines && was.lines) {
    patch.subtransactions = [];
  }
  return patch;
}

/** The body of a new schedule: the date is the series' first date. */
export function draftToScheduledCreate(
  d: Draft,
  accountId: string,
  today: string,
): ScheduledTransactionCreate {
  const date = parseEntryDate(d.dateText, today) as string;
  const memo = d.memo.trim();
  const payee = payeeFields(d.payee);
  return {
    account_id: accountId,
    date_first: date,
    frequency: d.frequency,
    amount: draftAmount(d),
    ...(memo ? { memo } : {}),
    ...("payee_id" in payee && payee.payee_id === null ? {} : payee),
    ...(d.category.kind === "none" ? {} : categoryFields(d.category)),
  };
}

/** Only what differs from the series as it was opened; a new date or frequency re-anchors it. */
export function draftToScheduledPatch(
  before: ScheduledTransaction,
  d: Draft,
  today: string,
): ScheduledTransactionUpdate {
  const was = draftFromScheduled(before);
  const patch: ScheduledTransactionUpdate = {};
  const date = parseEntryDate(d.dateText, today) as string;
  if (date !== before.date_next || d.frequency !== before.frequency) patch.date_first = date;
  if (d.frequency !== before.frequency) patch.frequency = d.frequency;
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
  return patch;
}
