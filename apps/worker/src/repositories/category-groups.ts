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
/** A `SELECT 1` that holds while `sort` is still the next free sort_order, for the guarded insert. */
export function sortIsNext(db: Db, budgetId: string, sort: number) {
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${categoryGroups.sortOrder}), -1) + 1 from ${categoryGroups} where ${categoryGroups.budgetId} = ${budgetId} and ${categoryGroups.deletedAt} is null) = ${sort}`,
    );
}

/** Inserts the row only while its sort_order is still the next free one (so concurrent creates never share one). */
export function insertIfSortStmt(db: Db, row: CategoryGroupRow) {
  const r = row;
  return db
    .insert(categoryGroups)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.sortOrder}, ${r.hidden ? 1 : 0}, ${r.collapsed ? 1 : 0}, ${r.createdAt}, ${r.updatedAt}, ${r.deletedAt} where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
    );
}
