import { and, eq, sql } from "drizzle-orm";
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

interface SetInput {
  budgetId: string;
  month: string;
  categoryId: string;
  assigned: number;
  updatedAt: string;
}

/** Upsert that sets Assigned to an absolute value. */
export function setStmt(db: Db, v: SetInput) {
  return db
    .insert(monthCategories)
    .values(v)
    .onConflictDoUpdate({
      target: [monthCategories.budgetId, monthCategories.month, monthCategories.categoryId],
      set: { assigned: v.assigned, updatedAt: v.updatedAt },
    });
}

/** Upsert that adds `delta` to Assigned, so concurrent moves never lose an update. */
export function addStmt(db: Db, v: Omit<SetInput, "assigned"> & { delta: number }) {
  const { delta, ...row } = v;
  return db
    .insert(monthCategories)
    .values({ ...row, assigned: delta })
    .onConflictDoUpdate({
      target: [monthCategories.budgetId, monthCategories.month, monthCategories.categoryId],
      set: {
        assigned: sql`${monthCategories.assigned} + excluded.assigned`,
        updatedAt: v.updatedAt,
      },
    });
}
