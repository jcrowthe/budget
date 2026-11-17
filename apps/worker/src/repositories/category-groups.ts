import { and, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categoryGroups } from "../db/schema/category-groups";
import { jsonBool } from "./guards";
import { insertSelect } from "./insert-select";

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
  return insertSelect(
    db,
    categoryGroups,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      sortOrder: r.sortOrder,
      hidden: r.hidden ? 1 : 0,
      collapsed: r.collapsed ? 1 : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      kind: r.kind,
    },
    sql`where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
  );
}

// EXF-494, EXF-495. The conditions below are SQL booleans: a guard ANDs them into a statement's WHERE.

/** The lowest sort_order among the plan's active groups, or null when there is none. */
export async function minSort(db: Db, budgetId: string): Promise<number | null> {
  const [r] = await db
    .select({ m: sql<number | null>`min(${categoryGroups.sortOrder})` })
    .from(categoryGroups)
    .where(and(eq(categoryGroups.budgetId, budgetId), isNull(categoryGroups.deletedAt)));
  return r?.m ?? null;
}

/** Holds while `sort` is still one below the lowest active sort_order (0 for a plan with no group). */
export function sortIsFirst(budgetId: string, sort: number): SQL {
  return sql`(select coalesce(min(${categoryGroups.sortOrder}), 1) - 1 from ${categoryGroups} where ${categoryGroups.budgetId} = ${budgetId} and ${categoryGroups.deletedAt} is null) = ${sort}`;
}

/** Holds while no other active group of the plan has this name (trimmed, case-insensitive). */
export function nameFree(budgetId: string, name: string, exceptId?: string): SQL {
  return sql`not exists (select 1 from ${categoryGroups} where ${categoryGroups.budgetId} = ${budgetId} and ${categoryGroups.deletedAt} is null and ${exceptId ? sql`${categoryGroups.id} <> ${exceptId}` : sql`1`} and lower(trim(${categoryGroups.name})) = lower(trim(${name})))`;
}

export async function nameTaken(
  db: Db,
  budgetId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db.all(sql`select 1 as x where not (${nameFree(budgetId, name, exceptId)})`);
  return rows.length > 0;
}

/** Holds while the active group still has this `updated_at`. */
export function holds(id: string, updatedAt: string): SQL {
  return sql`exists (select 1 from ${categoryGroups} where ${categoryGroups.id} = ${id} and ${categoryGroups.deletedAt} is null and ${categoryGroups.updatedAt} = ${updatedAt})`;
}

/** Inserts the row only while `guard` holds. */
export function insertIfStmt(db: Db, r: CategoryGroupRow, guard: SQL) {
  return insertSelect(
    db,
    categoryGroups,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      sortOrder: r.sortOrder,
      hidden: r.hidden ? 1 : 0,
      collapsed: r.collapsed ? 1 : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      kind: r.kind,
    },
    sql`where ${guard}`,
  );
}

export function updateIfStmt(
  db: Db,
  id: string,
  set: Partial<Pick<CategoryGroupRow, "name" | "hidden" | "collapsed" | "updatedAt">>,
  guard: SQL,
) {
  return db
    .update(categoryGroups)
    .set(set)
    .where(and(eq(categoryGroups.id, id), isNull(categoryGroups.deletedAt), guard));
}

export function softDeleteStmt(db: Db, id: string, now: string, guard: SQL) {
  return db
    .update(categoryGroups)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(categoryGroups.id, id), isNull(categoryGroups.deletedAt), guard));
}

/** The plan's active hidden groups (for `unhide_all`). */
export async function listHidden(db: Db, budgetId: string): Promise<CategoryGroupRow[]> {
  return db
    .select()
    .from(categoryGroups)
    .where(
      and(
        eq(categoryGroups.budgetId, budgetId),
        isNull(categoryGroups.deletedAt),
        eq(categoryGroups.hidden, true),
      ),
    );
}

/** `select` of the active hidden groups of a plan, in the columns `logSelectStmt` needs. */
export function hiddenGroupsInner(budgetId: string): SQL {
  return sql`select * from ${categoryGroups} where ${categoryGroups.budgetId} = ${budgetId} and ${categoryGroups.deletedAt} is null and ${categoryGroups.hidden} = 1`;
}

export function unhideAllGroupsStmt(db: Db, budgetId: string, now: string) {
  return db
    .update(categoryGroups)
    .set({ hidden: false, updatedAt: now })
    .where(
      and(
        eq(categoryGroups.budgetId, budgetId),
        isNull(categoryGroups.deletedAt),
        eq(categoryGroups.hidden, true),
      ),
    );
}

export const groupJson = (to?: boolean): SQL =>
  sql`json_object('id', id, 'budget_id', budget_id, 'name', name, 'sort', sort_order, 'hidden', ${jsonBool(to === undefined ? sql`hidden` : to ? sql`1` : sql`0`)}, 'collapsed', ${jsonBool(sql`collapsed`)})`;
