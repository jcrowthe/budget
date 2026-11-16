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

/** Inserts the snooze only while `guard` holds (the statement before it in the batch changed a row). */
export function insertIfStmt(db: Db, row: TargetSnoozeRow, guard: SQL) {
  return db
    .insert(targetSnoozes)
    .select(
      sql`select ${row.budgetId}, ${row.categoryId}, ${row.month}, ${row.createdAt} where ${guard}`,
    );
}

export function deleteStmt(
  db: Db,
  budgetId: string,
  categoryId: string,
  month: string,
  guard: SQL = sql`1`,
) {
  return db
    .delete(targetSnoozes)
    .where(
      and(
        eq(targetSnoozes.budgetId, budgetId),
        eq(targetSnoozes.categoryId, categoryId),
        eq(targetSnoozes.month, month),
        guard,
      ),
    );
}

/** A `SELECT 1` that holds while the snooze row is absent (to snooze) or present (to unsnooze), and the target exists. */
export function stateHolds(
  db: Db,
  budgetId: string,
  categoryId: string,
  month: string,
  snoozed: boolean,
) {
  const row = sql`exists (select 1 from target_snoozes where budget_id = ${budgetId} and category_id = ${categoryId} and month = ${month})`;
  const target = sql`exists (select 1 from targets where budget_id = ${budgetId} and category_id = ${categoryId})`;
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(snoozed ? sql`not ${row} and ${target}` : sql`${row} and ${target}`);
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
