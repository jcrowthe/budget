import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { targetSnoozes } from "../db/schema/target-snoozes";

export type TargetSnoozeRow = typeof targetSnoozes.$inferSelect;

export async function listForBudget(
  db: Db,
  budgetId: string,
): Promise<{ categoryId: string; month: string }[]> {
  return db
    .select({ categoryId: targetSnoozes.categoryId, month: targetSnoozes.month })
    .from(targetSnoozes)
    .where(eq(targetSnoozes.budgetId, budgetId));
}

export async function find(
  db: Db,
  budgetId: string,
  categoryId: string,
  month: string,
): Promise<boolean> {
  const [row] = await db
    .select({ month: targetSnoozes.month })
    .from(targetSnoozes)
    .where(
      and(
        eq(targetSnoozes.budgetId, budgetId),
        eq(targetSnoozes.categoryId, categoryId),
        eq(targetSnoozes.month, month),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export function insertStmt(db: Db, row: TargetSnoozeRow) {
  return db.insert(targetSnoozes).values(row).onConflictDoNothing();
}

export function deleteStmt(db: Db, budgetId: string, categoryId: string, month: string) {
  return db
    .delete(targetSnoozes)
    .where(
      and(
        eq(targetSnoozes.budgetId, budgetId),
        eq(targetSnoozes.categoryId, categoryId),
        eq(targetSnoozes.month, month),
      ),
    );
}

/** Every snooze of a category (its target is gone). `guard` ties it to the delete before it in a batch. */
export function deleteForCategoryStmt(
  db: Db,
  budgetId: string,
  categoryId: string,
  guard: SQL = sql`1`,
) {
  return db
    .delete(targetSnoozes)
    .where(
      and(eq(targetSnoozes.budgetId, budgetId), eq(targetSnoozes.categoryId, categoryId), guard),
    );
}
