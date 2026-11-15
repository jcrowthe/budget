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

export function insertStmt(db: Db, row: CategoryRow) {
  return db.insert(categories).values(row);
}
