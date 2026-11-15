import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { budgets } from "../db/schema/budgets";

export type BudgetRow = typeof budgets.$inferSelect;

export async function listActive(db: Db): Promise<BudgetRow[]> {
  return db.select().from(budgets).where(isNull(budgets.deletedAt)).orderBy(budgets.createdAt);
}

export async function findActive(db: Db, id: string): Promise<BudgetRow | undefined> {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)))
    .limit(1);
  return row;
}

/** The *Stmt functions return UNEXECUTED statements for `db.batch`. */
export function insertStmt(db: Db, row: BudgetRow) {
  return db.insert(budgets).values(row);
}

export function updateStmt(db: Db, id: string, patch: { name?: string }, updatedAt: string) {
  return db
    .update(budgets)
    .set({ ...patch, updatedAt })
    .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)));
}

export function softDeleteStmt(db: Db, id: string, at: string) {
  return db
    .update(budgets)
    .set({ deletedAt: at, updatedAt: at })
    .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)));
}
