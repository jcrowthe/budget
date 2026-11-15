import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
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

/** True only while the row is still exactly the one that was read (active, same updated_at). */
export function unchanged(row: Pick<BudgetRow, "id" | "updatedAt">): SQL {
  return and(
    eq(budgets.id, row.id),
    isNull(budgets.deletedAt),
    eq(budgets.updatedAt, row.updatedAt),
  ) as SQL;
}

export function updateStmt(
  db: Db,
  before: BudgetRow,
  patch: { name?: string; lastOpenedAt?: string },
  updatedAt: string,
) {
  return db
    .update(budgets)
    .set({ ...patch, updatedAt })
    .where(unchanged(before));
}

/** Stamps last_opened_at only: unguarded by updated_at, and does not touch updated_at. */
export function markOpenedStmt(db: Db, id: string, at: string) {
  return db
    .update(budgets)
    .set({ lastOpenedAt: at })
    .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)));
}

export function softDeleteStmt(db: Db, before: BudgetRow, at: string) {
  return db.update(budgets).set({ deletedAt: at, updatedAt: at }).where(unchanged(before));
}

/** A `SELECT 1` on the unchanged row, for `changeLogInsertIf`. */
export function existsUnchanged(db: Db, before: BudgetRow) {
  return db.select({ x: sql`1` }).from(budgets).where(unchanged(before));
}
