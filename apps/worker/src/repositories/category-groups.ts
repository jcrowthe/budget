import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categoryGroups } from "../db/schema/category-groups";

export type CategoryGroupRow = typeof categoryGroups.$inferSelect;

export async function listActive(db: Db, budgetId: string): Promise<CategoryGroupRow[]> {
  return db
    .select()
    .from(categoryGroups)
    .where(and(eq(categoryGroups.budgetId, budgetId), isNull(categoryGroups.deletedAt)))
    .orderBy(categoryGroups.sortOrder, categoryGroups.id);
}

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<CategoryGroupRow | undefined> {
  const [row] = await db
    .select()
    .from(categoryGroups)
    .where(
      and(
        eq(categoryGroups.id, id),
        eq(categoryGroups.budgetId, budgetId),
        isNull(categoryGroups.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** The highest sort_order among the plan's active groups, or -1 when there is none. */
export async function maxSort(db: Db, budgetId: string): Promise<number> {
  const [r] = await db
    .select({ m: sql<number | null>`max(${categoryGroups.sortOrder})` })
    .from(categoryGroups)
    .where(and(eq(categoryGroups.budgetId, budgetId), isNull(categoryGroups.deletedAt)));
  return r?.m ?? -1;
}

/** Returns an UNEXECUTED statement for `db.batch`. */
export function insertStmt(db: Db, row: CategoryGroupRow) {
  return db.insert(categoryGroups).values(row);
}
