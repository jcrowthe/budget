import { categoryCell, REGISTER_CREDIT_TYPES } from "./register";
import type { PlanTransaction } from "./transactions";

export type SelRow = Pick<
  PlanTransaction,
  | "id"
  | "account_id"
  | "amount"
  | "cleared"
  | "approved"
  | "import_id"
  | "source"
  | "transfer_account_id"
  | "transfer_transaction_id"
  | "subtransactions"
  | "payee_system"
  | "flag_color"
  | "category_id"
  | "inflow_to_ready_to_assign"
>;
export type SelAccount = { id: string; type: string; on_budget: boolean; closed: boolean };

export const countLabel = (n: number) => `${n} ${n === 1 ? "Transaction" : "Transactions"}`;

/** The signed sum of the selected rows (milliunits) and how many there are. */
export function selectedTotal(rows: readonly Pick<SelRow, "amount">[]): {
  count: number;
  total: number;
} {
  return { count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
}

/** True when a category can be set on the row: not reconciled, not a split, on budget, and a category is needed. */
export function takesCategory(r: SelRow, acct: SelAccount, other: SelAccount | null): boolean {
  if (r.cleared === "reconciled" || r.subtransactions.length > 0 || !acct.on_budget) return false;
  if (REGISTER_CREDIT_TYPES.includes(acct.type) && r.payee_system === "starting_balance")
    return false;
  const cell = categoryCell(
    {
      ...r,
      payee_name: null,
      memo: null,
      date: "",
      created_at: "",
      category_name: null,
      category_group_name: null,
    },
    acct,
    other,
  );
  return cell.kind !== "notNeeded" && cell.kind !== "split";
}

/** `clear` if some non-reconciled row is uncleared; `unclear` if every one of them is cleared; else null. */
export function clearOp(rows: readonly Pick<SelRow, "cleared">[]): "clear" | "unclear" | null {
  const live = rows.filter((r) => r.cleared !== "reconciled");
  if (live.length === 0) return null;
  if (live.some((r) => r.cleared === "uncleared")) return "clear";
  return "unclear";
}

export function barActions(
  rows: readonly SelRow[],
  accountOf: (id: string) => SelAccount | null,
  _where: "account" | "all",
) {
  const otherOf = (r: SelRow) => (r.transfer_account_id ? accountOf(r.transfer_account_id) : null);
  return {
    approve: rows.some((r) => !r.approved),
    reject:
      rows.length > 0 &&
      rows.every(
        (r) => !r.approved && r.import_id !== null && r.source !== null && !r.transfer_account_id,
      ),
    categorize: rows.some((r) => {
      const a = accountOf(r.account_id);
      return a ? takesCategory(r, a, otherOf(r)) : false;
    }),
    clear: clearOp(rows),
    makeRepeating: rows.length === 1,
    move: true,
    anyFlagged: rows.some((r) => r.flag_color !== null),
  };
}

export const DELETE_TEXT = {
  reconciledTitle: "Delete Reconciled Transaction?",
  reconciledBody: "Deleting a reconciled transaction will bring the reconciliation out of balance.",
  manyTitle: (n: number) => `Delete ${countLabel(n)}?`,
  transferBody: "Deleting a transfer transaction will delete the transfer in both accounts.",
  matchingBody:
    "Some matching transfers in other accounts have been reconciled. Deleting these transactions could bring those account's reconciliations out of balance.",
};

/**
 * What to ask before a delete, or null for no prompt: a single reconciled row, or several rows that include a
 * transfer or a reconciled row (or whose other sides are reconciled).
 */
export function deleteConfirm(
  rows: readonly SelRow[],
  otherReconciled: (r: SelRow) => boolean,
  forceMatching = false,
): null | { title: string; paragraphs: string[] } {
  const reconciled = rows.some((r) => r.cleared === "reconciled");
  const transfer = rows.some((r) => r.transfer_account_id);
  const matching = forceMatching || rows.some(otherReconciled);
  if (rows.length === 1 && !matching) {
    return reconciled
      ? { title: DELETE_TEXT.reconciledTitle, paragraphs: [DELETE_TEXT.reconciledBody] }
      : null;
  }
  if (!reconciled && !transfer && !matching) return null;
  const paragraphs: string[] = [];
  if (transfer) paragraphs.push(DELETE_TEXT.transferBody);
  if (reconciled) paragraphs.push(DELETE_TEXT.reconciledBody);
  if (matching) paragraphs.push(DELETE_TEXT.matchingBody);
  return { title: DELETE_TEXT.manyTitle(rows.length), paragraphs };
}

/**
 * A bulk refusal for the screen: the server's `Transaction <id>: <reason>` becomes `<row label>: <Reason>`, so the
 * id never shows. An id that is not among the rows reads "1 of the selected transactions".
 */
export function bulkRefusalText(detail: string, labelOf: (id: string) => string | null): string {
  const m = /^Transaction ([0-9a-f-]{36}): (.*)$/is.exec(detail);
  if (!m) return detail;
  const rest = m[2] ?? "";
  const label = labelOf(m[1] ?? "") ?? "1 of the selected transactions";
  return `${label}: ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/** The inclusive slice of `order` between two ids (in `order`'s order), or null when either is absent. */
export function rangeIds(order: readonly string[], from: string, to: string): string[] | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return null;
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
