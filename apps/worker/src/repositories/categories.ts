import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";

export type CategoryRow = typeof categories.$inferSelect;

/** Active categories whose group is active too. */
export async function listActive(db: Db, budgetId: string): Promise<CategoryRow[]> {
  const rows = await db
    .select({ c: categories })
    .from(categories)
    .innerJoin(
      categoryGroups,
      and(eq(categoryGroups.id, categories.groupId), isNull(categoryGroups.deletedAt)),
    )
    .where(and(eq(categories.budgetId, budgetId), isNull(categories.deletedAt)))
    .orderBy(categories.sortOrder, categories.id);
  return rows.map((r) => r.c);
}

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select({ c: categories })
    .from(categories)
    .innerJoin(
      categoryGroups,
      and(eq(categoryGroups.id, categories.groupId), isNull(categoryGroups.deletedAt)),
    )
    .where(
      and(eq(categories.id, id), eq(categories.budgetId, budgetId), isNull(categories.deletedAt)),
    )
    .limit(1);
  return row?.c;
}

/** The highest sort_order among the group's active categories, or -1 when there is none. */
export async function maxSort(db: Db, groupId: string): Promise<number> {
  const [r] = await db
    .select({ m: sql<number | null>`max(${categories.sortOrder})` })
    .from(categories)
    .where(and(eq(categories.groupId, groupId), isNull(categories.deletedAt)));
  return r?.m ?? -1;
}

/** A `SELECT 1` that holds while `sort` is still the next free sort_order, for the guarded insert. */
export function sortIsNext(db: Db, groupId: string, sort: number) {
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${categories.sortOrder}), -1) + 1 from ${categories} where ${categories.groupId} = ${groupId} and ${categories.deletedAt} is null) = ${sort}`,
    );
}

/** Inserts the row only while its sort_order is still the next free one (so concurrent creates never share one). */
export function insertIfSortStmt(db: Db, row: CategoryRow) {
  const r = row;
  return db
    .insert(categories)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.groupId}, ${r.name}, ${r.sortOrder}, ${r.hidden ? 1 : 0}, ${r.createdAt}, ${r.updatedAt}, ${r.deletedAt} where exists ${sortIsNext(db, r.groupId, r.sortOrder)}`,
    );
}
