import type { TransactionDetail } from "./transactions";

// Repeat core's CREDIT_ACCOUNT_TYPES and STARTING_BALANCE_PAYEE (this package does not depend on core);
// a Worker test asserts they are equal.
export const REGISTER_CREDIT_TYPES: readonly string[] = ["creditCard", "lineOfCredit"];
export const REGISTER_STARTING_PAYEE = "Starting Balance";

export const REGISTER_SORT_COLUMNS = [
  "date",
  "payee",
  "category",
  "memo",
  "outflow",
  "inflow",
] as const;
export type RegisterSortColumn = (typeof REGISTER_SORT_COLUMNS)[number];
export type SortDir = "asc" | "desc";

type SortableTx = Pick<
  TransactionDetail,
  | "id"
  | "date"
  | "amount"
  | "payee_name"
  | "memo"
  | "category_id"
  | "category_name"
  | "category_group_name"
  | "inflow_to_ready_to_assign"
  | "created_at"
>;

/** "Group: Name", "Inflow: Ready to Assign", or "" without either. */
export function categoryText(tx: SortableTx): string {
  if (tx.category_id && tx.category_name) {
    return tx.category_group_name
      ? `${tx.category_group_name}: ${tx.category_name}`
      : tx.category_name;
  }
  return tx.inflow_to_ready_to_assign ? "Inflow: Ready to Assign" : "";
}

export type CategoryCell =
  | { kind: "text"; text: string }
  | { kind: "notNeeded" }
  | { kind: "needsCategory" };

export function categoryCell(
  tx: SortableTx,
  account: { type: string; on_budget: boolean },
): CategoryCell {
  const text = categoryText(tx);
  if (text) return { kind: "text", text };
  if (!account.on_budget) return { kind: "notNeeded" };
  if (REGISTER_CREDIT_TYPES.includes(account.type) && tx.payee_name === REGISTER_STARTING_PAYEE) {
    return { kind: "notNeeded" };
  }
  return { kind: "needsCategory" };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function key(tx: SortableTx, column: RegisterSortColumn): string | number {
  switch (column) {
    case "date":
      return tx.date;
    case "payee":
      return tx.payee_name ?? "";
    case "category":
      return categoryText(tx);
    case "memo":
      return tx.memo ?? "";
    case "outflow":
      return tx.amount < 0 ? -tx.amount : 0;
    case "inflow":
      return tx.amount > 0 ? tx.amount : 0;
  }
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Orders rows for the register. The primary key follows `dir`; ties never do: newest date first (unless
 * sorting by date), then signed amount ascending, then creation time, then id.
 */
export function sortTransactions<T extends SortableTx>(
  rows: readonly T[],
  column: RegisterSortColumn,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareKeys(key(a, column), key(b, column)) * sign;
    if (primary !== 0) return primary;
    if (column !== "date" && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.amount !== b.amount) return a.amount - b.amount;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
