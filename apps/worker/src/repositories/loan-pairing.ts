import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { pairableCategory } from "./accounts";

/** Holds while the loan is active and open, still paired as read (`old`), and the category can take a pairing. */
function holds(budgetId: string, loanId: string, old: string | null, categoryId: string): SQL {
  const oldIs =
    old === null ? isNull(accounts.pairedCategoryId) : eq(accounts.pairedCategoryId, old);
  return sql`${and(
    eq(accounts.id, loanId),
    eq(accounts.budgetId, budgetId),
    isNull(accounts.deletedAt),
    eq(accounts.closed, false),
    oldIs,
  )} and ${pairableCategory(budgetId, categoryId)}`;
}

/** A `SELECT 1` that holds while `holds` does: the change_log row's guard. */
export function pairingHolds(
  db: Db,
  budgetId: string,
  loanId: string,
  old: string | null,
  categoryId: string,
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
  categoryId: string,
) {
  return db
    .update(accounts)
    .set({ pairedCategoryId: categoryId })
    .where(holds(budgetId, loanId, old, categoryId));
}
