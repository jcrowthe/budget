import type { TargetDefinition } from "@budget/core/targets";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { targets } from "../db/schema/targets";

export type TargetRow = typeof targets.$inferSelect;

export async function listForBudget(db: Db, budgetId: string): Promise<TargetRow[]> {
  return db.select().from(targets).where(eq(targets.budgetId, budgetId));
}

export async function find(
  db: Db,
  budgetId: string,
  categoryId: string,
): Promise<TargetRow | undefined> {
  const [row] = await db
    .select()
    .from(targets)
    .where(and(eq(targets.budgetId, budgetId), eq(targets.categoryId, categoryId)))
    .limit(1);
  return row;
}

export function toDefinition(row: TargetRow): TargetDefinition {
  return {
    cadence: row.cadence,
    behavior: row.behavior,
    amount: row.amount,
    day_of_week: row.dayOfWeek,
    day_of_month: row.dayOfMonth,
    due_date: row.dueDate,
    due_month: row.dueMonth,
    repeat:
      row.repeatEvery === null || row.repeatUnit === null
        ? null
        : { every: row.repeatEvery, unit: row.repeatUnit },
    created_on: row.createdOn,
  };
}

const same = (budgetId: string, categoryId: string) =>
  and(eq(targets.budgetId, budgetId), eq(targets.categoryId, categoryId));

/**
 * A `SELECT 1` that holds while the target is still what was read: its row has `beforeUpdatedAt`, or (when
 * undefined, no row was there) there is still no row. For `changeLogInsertIf`.
 */
export function holds(
  db: Db,
  budgetId: string,
  categoryId: string,
  beforeUpdatedAt: string | undefined,
) {
  if (beforeUpdatedAt === undefined) {
    return db
      .select({ x: sql`1` })
      .from(sql`(select 1)`)
      .where(sql`not exists (select 1 from ${targets} where ${same(budgetId, categoryId)})`);
  }
  return db
    .select({ x: sql`1` })
    .from(targets)
    .where(and(same(budgetId, categoryId), eq(targets.updatedAt, beforeUpdatedAt)));
}

/** Inserts (no row was read) or updates (the row still has `beforeUpdatedAt`); otherwise changes 0 rows. */
export function upsertIfHoldsStmt(db: Db, row: TargetRow, beforeUpdatedAt: string | undefined) {
  if (beforeUpdatedAt === undefined) {
    return db
      .insert(targets)
      .select(
        sql`select ${row.categoryId}, ${row.budgetId}, ${row.cadence}, ${row.behavior}, ${row.amount}, ${row.dayOfWeek}, ${row.dayOfMonth}, ${row.dueDate}, ${row.dueMonth}, ${row.repeatEvery}, ${row.repeatUnit}, ${row.createdOn}, ${row.createdAt}, ${row.updatedAt} where not exists (select 1 from ${targets} where ${same(row.budgetId, row.categoryId)})`,
      );
  }
  return db
    .update(targets)
    .set({
      cadence: row.cadence,
      behavior: row.behavior,
      amount: row.amount,
      dayOfWeek: row.dayOfWeek,
      dayOfMonth: row.dayOfMonth,
      dueDate: row.dueDate,
      dueMonth: row.dueMonth,
      repeatEvery: row.repeatEvery,
      repeatUnit: row.repeatUnit,
      updatedAt: row.updatedAt,
    })
    .where(and(same(row.budgetId, row.categoryId), eq(targets.updatedAt, beforeUpdatedAt)));
}

export function deleteIfHoldsStmt(
  db: Db,
  budgetId: string,
  categoryId: string,
  beforeUpdatedAt: string,
) {
  return db
    .delete(targets)
    .where(and(same(budgetId, categoryId), eq(targets.updatedAt, beforeUpdatedAt)));
}
