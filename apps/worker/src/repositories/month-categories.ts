import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { monthCategories } from "../db/schema/month-categories";

export type MonthCategoryRow = typeof monthCategories.$inferSelect;

export async function listForBudget(db: Db, budgetId: string): Promise<MonthCategoryRow[]> {
  return db.select().from(monthCategories).where(eq(monthCategories.budgetId, budgetId));
}

export async function find(
  db: Db,
  budgetId: string,
  month: string,
  categoryId: string,
): Promise<MonthCategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(monthCategories)
    .where(
      and(
        eq(monthCategories.budgetId, budgetId),
        eq(monthCategories.month, month),
        eq(monthCategories.categoryId, categoryId),
      ),
    )
    .limit(1);
  return row;
}

interface Cell {
  budgetId: string;
  month: string;
  categoryId: string;
}

const sameCell = (c: Cell) =>
  and(
    eq(monthCategories.budgetId, c.budgetId),
    eq(monthCategories.month, c.month),
    eq(monthCategories.categoryId, c.categoryId),
  );

/**
 * A `SELECT 1` that holds while the cell is still what was read: its row holds `before`, or (when `before` is
 * undefined, the row was missing) there is still no row. For `changeLogInsertIf`.
 */
export function holds(db: Db, c: Cell, before: number | undefined) {
  if (before === undefined) {
    return db
      .select({ x: sql`1` })
      .from(sql`(select 1)`)
      .where(sql`not exists (select 1 from ${monthCategories} where ${sameCell(c)})`);
  }
  return db
    .select({ x: sql`1` })
    .from(monthCategories)
    .where(and(sameCell(c), eq(monthCategories.assigned, before)));
}

/**
 * Sets the cell to `assigned` only while it still holds `before` (see `holds`); otherwise it changes 0 rows.
 * `guard` is an extra condition: a two-sided move guards its first write on both cells holding and its second
 * on `changes() > 0` (the first write changed a row), so both sides are written or neither.
 */
export function setIfHoldsStmt(
  db: Db,
  c: Cell,
  before: number | undefined,
  assigned: number,
  updatedAt: string,
  guard: SQL = sql`1`,
) {
  const prev = guard;
  if (before === undefined) {
    return db
      .insert(monthCategories)
      .select(
        sql`select ${c.budgetId}, ${c.month}, ${c.categoryId}, ${assigned}, ${updatedAt} where not exists (select 1 from ${monthCategories} where ${sameCell(c)}) and ${prev}`,
      );
  }
  return db
    .update(monthCategories)
    .set({ assigned, updatedAt })
    .where(and(sameCell(c), eq(monthCategories.assigned, before), prev));
}
