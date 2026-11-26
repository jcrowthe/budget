import { evaluateAmountEntry, formatAmountEntry, signedAmount } from "@budget/schema/amount-entry";
import { formatEntryDate } from "@budget/schema/date-entry";
import type { Payee } from "@budget/schema/payees";
import type { PlanFormatter } from "@budget/schema/plan-formats";
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
import { transferPayeeName } from "@budget/schema/transfers";

/** The payee's suggested category (`off` → nothing; see docs/payee-category-design.md): its effective default. */
export function rememberedCategory(
  p: Pick<Payee, "default_category_id" | "default_inflow_to_ready_to_assign">,
): CategoryValue | null {
  if (p.default_category_id) return { kind: "category", id: p.default_category_id };
  return p.default_inflow_to_ready_to_assign ? { kind: "rta" } : null;
}

export type Field = "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow";

/** What the register has open: nothing, a new row, or one row being edited. */
export type Open =
  | null
  | {
      mode: "add";
      key: number;
      date?: string;
      payment?: { inflow: number | null };
      /** Make Repeating: the new row starts from this draft. */
      prefill?: Draft;
    }
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

/** The milliunits typed in a field, read with the plan's separators and decimal digits. */
export const typedAmount = (text: string, fmt: PlanFormatter): number | null =>
  evaluateAmountEntry(fmt.typedAmount(text), fmt.digits);

export const lineAmount = (
  l: Pick<LineDraft, "outflowText" | "inflowText">,
  fmt: PlanFormatter,
): number => signedAmount(typedAmount(l.outflowText, fmt), typedAmount(l.inflowText, fmt));

/** The text of an amount in its column: outflow for a negative one. */
export const amountTexts = (amount: number, fmt: PlanFormatter) => ({
  outflowText: amount < 0 ? formatAmountEntry(-amount, fmt) : "",
  inflowText: amount > 0 ? formatAmountEntry(amount, fmt) : "",
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
  /** A reconciled row keeps its state in the editor (the lock is never toggled). */
  cleared: "uncleared" | "cleared" | "reconciled";
  /** The calendar's Repeat select; "never" for a real row. */
  frequency: Frequency;
};

export function emptyDraft(date: string, accountId: string | null, fmt: PlanFormatter): Draft {
  return {
    transferAccountId: null,
    lines: null,
    accountId,
    dateText: formatEntryDate(date, fmt),
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

/** The lines of a split as the editor holds them (a real split's and a schedule's have the same shape); null for none. */
export function draftLines(
  subs: readonly {
    payee_id: string | null;
    payee_name: string | null;
    category_id: string | null;
    inflow_to_ready_to_assign: boolean;
    memo: string | null;
    amount: number;
  }[],
  fmt: PlanFormatter,
): LineDraft[] | null {
  if (subs.length === 0) return null;
  return subs.map((l) => ({
    key: ++lineKey,
    payee: { id: l.payee_id, name: l.payee_name ?? "" },
    category: l.category_id
      ? { kind: "category", id: l.category_id }
      : l.inflow_to_ready_to_assign
        ? { kind: "rta" }
        : { kind: "none" },
    memo: l.memo ?? "",
    ...amountTexts(l.amount, fmt),
  }));
}

export function draftFromTx(tx: TransactionDetail, fmt: PlanFormatter): Draft {
  return {
    transferAccountId: tx.transfer_account_id,
    lines: draftLines(tx.subtransactions, fmt),
    accountId: tx.account_id,
    dateText: formatEntryDate(tx.date, fmt),
    lastDate: tx.date,
    payee: { id: tx.payee_id, name: tx.payee_name ?? "" },
    category: tx.category_id
      ? { kind: "category", id: tx.category_id }
      : tx.inflow_to_ready_to_assign
        ? { kind: "rta" }
        : { kind: "none" },
    memo: tx.memo ?? "",
    outflowText: tx.amount < 0 ? formatAmountEntry(-tx.amount, fmt) : "",
    inflowText: tx.amount > 0 ? formatAmountEntry(tx.amount, fmt) : "",
    cleared: tx.cleared,
    frequency: "never",
  };
}

/** A scheduled row opened for editing: its next date and its frequency. */
export function draftFromScheduled(s: ScheduledTransaction, fmt: PlanFormatter): Draft {
  return {
    transferAccountId: s.transfer_account_id,
    lines: draftLines(s.subtransactions, fmt),
    accountId: s.account_id,
    dateText: formatEntryDate(s.date_next, fmt),
    lastDate: s.date_next,
    payee: s.transfer_account_id
      ? { id: null, name: transferPayeeName(s.transfer_account_name ?? "") }
      : { id: s.payee_id, name: s.payee_name ?? "" },
    category: s.category_id
      ? { kind: "category", id: s.category_id }
      : s.inflow_to_ready_to_assign
        ? { kind: "rta" }
        : { kind: "none" },
    memo: s.memo ?? "",
    ...amountTexts(s.amount, fmt),
    cleared: "uncleared",
    frequency: s.frequency,
  };
}

export function draftAmount(d: Draft, fmt: PlanFormatter): number {
  return signedAmount(typedAmount(d.outflowText, fmt), typedAmount(d.inflowText, fmt));
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
export function draftError(
  d: Draft,
  today: string,
  needAccount: boolean,
  fmt: PlanFormatter,
): DraftError {
  if (needAccount && !d.accountId) return { field: "account", message: "Choose an account." };
  if (!fmt.parseDate(d.dateText, today)) {
    return { field: "date", message: `Enter a date like ${fmt.date("2026-11-15")}.` };
  }
  return null;
}

const linesBody = (lines: LineDraft[], fmt: PlanFormatter): SubTransactionInput[] =>
  lines.map((l) => {
    const memo = l.memo.trim();
    return {
      amount: lineAmount(l, fmt),
      ...(l.payee.id || l.payee.name.trim() !== "" ? payeeFields(l.payee) : {}),
      ...(l.category.kind === "none" ? {} : categoryFields(l.category)),
      ...(memo ? { memo } : {}),
    };
  });

/** Compares lines by what they would send. */
const linesSignature = (lines: LineDraft[] | null, fmt: PlanFormatter) =>
  lines === null
    ? null
    : JSON.stringify(
        lines.map((l) => [
          lineAmount(l, fmt),
          l.payee.id ?? l.payee.name.trim(),
          l.category,
          l.memo.trim(),
        ]),
      );

export function draftToCreate(
  d: Draft,
  accountId: string,
  today: string,
  fmt: PlanFormatter,
): TransactionCreateRequest {
  const date = fmt.parseDate(d.dateText, today) as string;
  const memo = d.memo.trim();
  const payee = payeeFields(d.payee);
  return {
    account_id: accountId,
    date,
    amount: draftAmount(d, fmt),
    cleared: d.cleared === "cleared" ? "cleared" : "uncleared",
    approved: true,
    ...(memo ? { memo } : {}),
    ...(d.transferAccountId
      ? { transfer_account_id: d.transferAccountId }
      : "payee_id" in payee && payee.payee_id === null
        ? {}
        : payee),
    ...(d.category.kind === "none" || d.lines ? {} : categoryFields(d.category)),
    ...(d.lines ? { subtransactions: linesBody(d.lines, fmt) } : {}),
  };
}

/** Only the fields that differ from the row as it was opened. */
export function draftToPatch(
  before: TransactionDetail,
  d: Draft,
  today: string,
  fmt: PlanFormatter,
): TransactionUpdateRequest {
  const was = draftFromTx(before, fmt);
  const patch: TransactionUpdateRequest = {};
  const date = fmt.parseDate(d.dateText, today) as string;
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
  const amount = draftAmount(d, fmt);
  if (amount !== before.amount) patch.amount = amount;
  if (d.cleared !== was.cleared) patch.cleared = d.cleared;
  if (
    d.lines &&
    (linesSignature(d.lines, fmt) !== linesSignature(was.lines, fmt) || amount !== before.amount)
  ) {
    patch.subtransactions = linesBody(d.lines, fmt);
    patch.amount = amount;
  } else if (!d.lines && was.lines) {
    patch.subtransactions = [];
  }
  return patch;
}

/** True when saving this patch changes what a reconciled row is locked on: amount, date or account. */
export function touchesLocked(patch: TransactionUpdateRequest): boolean {
  return patch.amount !== undefined || patch.date !== undefined || patch.account_id !== undefined;
}

/** The body of a new schedule: the date is the series' first date. */
export function draftToScheduledCreate(
  d: Draft,
  accountId: string,
  today: string,
  fmt: PlanFormatter,
): ScheduledTransactionCreate {
  const date = fmt.parseDate(d.dateText, today) as string;
  const memo = d.memo.trim();
  const payee = payeeFields(d.payee);
  return {
    account_id: accountId,
    date_first: date,
    frequency: d.frequency,
    amount: draftAmount(d, fmt),
    ...(memo ? { memo } : {}),
    // A transfer has no payee: its payee is the other account.
    ...(d.transferAccountId
      ? { transfer_account_id: d.transferAccountId }
      : "payee_id" in payee && payee.payee_id === null
        ? {}
        : payee),
    ...(d.category.kind === "none" || d.lines ? {} : categoryFields(d.category)),
    ...(d.lines ? { subtransactions: linesBody(d.lines, fmt) } : {}),
  };
}

/** Only what differs from the series as it was opened; a new date or frequency re-anchors it. */
export function draftToScheduledPatch(
  before: ScheduledTransaction,
  d: Draft,
  today: string,
  fmt: PlanFormatter,
): ScheduledTransactionUpdate {
  const was = draftFromScheduled(before, fmt);
  const patch: ScheduledTransactionUpdate = {};
  const date = fmt.parseDate(d.dateText, today) as string;
  if (date !== before.date_next || d.frequency !== before.frequency) patch.date_first = date;
  if (d.frequency !== before.frequency) patch.frequency = d.frequency;
  if (d.accountId && d.accountId !== before.account_id) patch.account_id = d.accountId;
  const transferChanged = d.transferAccountId !== before.transfer_account_id;
  // A series that stays a transfer sends no payee; one made plain again sends the payee typed over it.
  const payeeChanged = d.payee.id
    ? d.payee.id !== before.payee_id
    : d.payee.name.trim() !== (before.payee_name ?? "");
  if (transferChanged) patch.transfer_account_id = d.transferAccountId;
  if (!d.transferAccountId && (payeeChanged || transferChanged)) {
    Object.assign(patch, payeeFields(d.payee));
  }
  if (!d.lines && JSON.stringify(d.category) !== JSON.stringify(was.category)) {
    Object.assign(patch, categoryFields(d.category));
  }
  if (d.memo.trim() !== (before.memo ?? ""))
    patch.memo = d.memo.trim() === "" ? null : d.memo.trim();
  const amount = draftAmount(d, fmt);
  if (amount !== before.amount) patch.amount = amount;
  // Lines are replaced as a whole, with the total they add up to; leaving a split sends an empty list.
  if (
    d.lines &&
    (linesSignature(d.lines, fmt) !== linesSignature(was.lines, fmt) || amount !== before.amount)
  ) {
    patch.subtransactions = linesBody(d.lines, fmt);
    patch.amount = amount;
  } else if (!d.lines && was.lines) {
    patch.subtransactions = [];
  }
  return patch;
}
