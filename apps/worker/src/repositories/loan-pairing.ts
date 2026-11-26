import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { pairableCategory } from "./accounts";

/** Holds while the loan is active and open and still paired as read (`old`). */
function loanHolds(budgetId: string, loanId: string, old: string | null): SQL {
  const oldIs =
    old === null ? isNull(accounts.pairedCategoryId) : eq(accounts.pairedCategoryId, old);
  return and(
    eq(accounts.id, loanId),
    eq(accounts.budgetId, budgetId),
    isNull(accounts.deletedAt),
    eq(accounts.closed, false),
    oldIs,
  ) as SQL;
}

/** `loanHolds`, and the category can take a pairing; a null target (unpair) needs only the loan part. */
function holds(
  budgetId: string,
  loanId: string,
  old: string | null,
  categoryId: string | null,
): SQL {
  return categoryId === null
    ? loanHolds(budgetId, loanId, old)
    : sql`${loanHolds(budgetId, loanId, old)} and ${pairableCategory(budgetId, categoryId)}`;
}

/** A `SELECT 1` that holds while the loan part of the pairing guard does (a new category is created under it). */
export function loanOnlyHolds(db: Db, budgetId: string, loanId: string, old: string | null) {
  return db
    .select({ x: sql`1` })
    .from(accounts)
    .where(loanHolds(budgetId, loanId, old));
}

/** A `SELECT 1` that holds while `holds` does: the change_log row's guard. */
export function pairingHolds(
  db: Db,
  budgetId: string,
  loanId: string,
  old: string | null,
  categoryId: string | null,
) {
  return db
    .select({ x: sql`1` })
    .from(accounts)
    .where(holds(budgetId, loanId, old, categoryId));
}

export function setPairingStmt(
  db: Db,
  budgetId: string,
  loanId: string,
  old: string | null,
  categoryId: string | null,
) {
  return db
    .update(accounts)
    .set({ pairedCategoryId: categoryId })
    .where(holds(budgetId, loanId, old, categoryId));
}
