import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { allOf, idList, jsonBool } from "./guards";
import { insertSelect } from "./insert-select";

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
  return insertSelect(
    db,
    categories,
    {
      id: r.id,
      budgetId: r.budgetId,
      groupId: r.groupId,
      name: r.name,
      sortOrder: r.sortOrder,
      hidden: r.hidden ? 1 : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      note: r.note,
      kind: r.kind,
      accountId: r.accountId,
    },
    sql`where exists ${sortIsNext(db, r.groupId, r.sortOrder)}`,
  );
}

// EXF-494, EXF-495. The conditions below are SQL booleans: a guard ANDs them into a statement's WHERE.

/** The lowest sort_order among the group's active categories, or null when there is none. */
export async function minSort(db: Db, groupId: string): Promise<number | null> {
  const [r] = await db
    .select({ m: sql<number | null>`min(${categories.sortOrder})` })
    .from(categories)
    .where(and(eq(categories.groupId, groupId), isNull(categories.deletedAt)));
  return r?.m ?? null;
}

/** Holds while `sort` is still one below the lowest active sort_order of the group (0 when it is empty). */
export function sortIsFirst(groupId: string, sort: number): SQL {
  return sql`(select coalesce(min(${categories.sortOrder}), 1) - 1 from ${categories} where ${categories.groupId} = ${groupId} and ${categories.deletedAt} is null) = ${sort}`;
}

/** Holds while no other active category of the group has this name (trimmed, case-insensitive). */
export function nameFree(groupId: string, name: string, exceptId?: string): SQL {
  return sql`not exists (select 1 from ${categories} where ${categories.groupId} = ${groupId} and ${categories.deletedAt} is null and ${exceptId ? sql`${categories.id} <> ${exceptId}` : sql`1`} and lower(trim(${categories.name})) = lower(trim(${name})))`;
}

export async function nameTaken(
  db: Db,
  groupId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db.all(sql`select 1 as x where not (${nameFree(groupId, name, exceptId)})`);
  return rows.length > 0;
}

/** Holds while the active category still has this `updated_at`. */
export function holds(id: string, updatedAt: string): SQL {
  return sql`exists (select 1 from ${categories} where ${categories.id} = ${id} and ${categories.deletedAt} is null and ${categories.updatedAt} = ${updatedAt})`;
}

export function insertIfStmt(db: Db, r: CategoryRow, guard: SQL) {
  return insertSelect(
    db,
    categories,
    {
      id: r.id,
      budgetId: r.budgetId,
      groupId: r.groupId,
      name: r.name,
      sortOrder: r.sortOrder,
      hidden: r.hidden ? 1 : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      note: r.note,
      kind: r.kind,
      accountId: r.accountId,
    },
    sql`where ${guard}`,
  );
}

export function updateIfStmt(
  db: Db,
  id: string,
  set: Partial<Pick<CategoryRow, "name" | "hidden" | "note" | "updatedAt">>,
  guard: SQL,
) {
  return db
    .update(categories)
    .set(set)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt), guard));
}

export async function listActiveInGroup(db: Db, groupId: string): Promise<CategoryRow[]> {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.groupId, groupId), isNull(categories.deletedAt)))
    .orderBy(categories.sortOrder, categories.id);
}

/** The `where` shared by the flip statements: active categories of a group now hidden/unhidden. */
function flipWhere(groupId: string, to: boolean, exceptId?: string): SQL {
  return sql`${categories.groupId} = ${groupId} and ${categories.deletedAt} is null and ${categories.hidden} = ${to ? 0 : 1}${exceptId ? sql` and ${categories.id} <> ${exceptId}` : sql``}`;
}

/** Sets `hidden = to` on the group's active categories that have the other value (except one). */
export function flipInGroupStmt(
  db: Db,
  groupId: string,
  to: boolean,
  now: string,
  guard: SQL,
  exceptId?: string,
) {
  return db
    .update(categories)
    .set({ hidden: to, updatedAt: now })
    .where(sql`${flipWhere(groupId, to, exceptId)} and ${guard}`);
}

/** The categories `flipInGroupStmt` would change, as a `select` for `logSelectStmt`. */
export function flipInGroupInner(groupId: string, to: boolean, guard: SQL, exceptId?: string): SQL {
  return sql`select * from ${categories} where ${flipWhere(groupId, to, exceptId)} and ${guard}`;
}

export function hiddenInPlanInner(budgetId: string): SQL {
  return sql`select * from ${categories} where ${categories.budgetId} = ${budgetId} and ${categories.deletedAt} is null and ${categories.hidden} = 1`;
}

export function unhideAllStmt(db: Db, budgetId: string, now: string) {
  return db
    .update(categories)
    .set({ hidden: false, updatedAt: now })
    .where(
      and(
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
        eq(categories.hidden, true),
      ),
    );
}

export async function listHiddenInPlan(db: Db, budgetId: string): Promise<CategoryRow[]> {
  return db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
        eq(categories.hidden, true),
      ),
    );
}

/** Soft-deletes the active categories in `ids` while `guard` holds. */
export function softDeleteManyStmt(db: Db, ids: readonly string[], now: string, guard: SQL) {
  return db
    .update(categories)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(sql`${categories.id} in (${idList(ids)})`, isNull(categories.deletedAt), guard));
}

/** The `select` a category-change log row is built from (its columns are those of `categories`). */
export const categoryJson = (): SQL =>
  sql`json_object('id', id, 'budget_id', budget_id, 'group_id', group_id, 'name', name, 'sort', sort_order, 'hidden', ${jsonBool(sql`hidden`)}, 'note', note)`;
export const categoryJsonHidden = (to: boolean): SQL =>
  sql`json_object('id', id, 'budget_id', budget_id, 'group_id', group_id, 'name', name, 'sort', sort_order, 'hidden', ${jsonBool(to ? sql`1` : sql`0`)}, 'note', note)`;

/** A category group's or category's history (R5): active transactions and months with a non-zero assigned. */
export async function historyOf(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<{ transactions: number; assignedMonths: number; schedules: number }> {
  if (ids.length === 0) return { transactions: 0, assignedMonths: 0, schedules: 0 };
  const [r] = await db.all<{ t: number; a: number; s: number }>(
    sql`select (select count(*) from transactions where budget_id = ${budgetId} and deleted_at is null and category_id in (${idList(ids)})) as t, (select count(distinct month) from month_categories where budget_id = ${budgetId} and assigned <> 0 and category_id in (${idList(ids)})) as a, (select count(*) from scheduled_transactions where budget_id = ${budgetId} and deleted_at is null and (category_id in (${idList(ids)}) or id in (select l.scheduled_transaction_id from scheduled_subtransactions l where l.deleted_at is null and l.category_id in (select value from json_each(${JSON.stringify(ids)}))))) as s`,
  );
  return { transactions: r?.t ?? 0, assignedMonths: r?.a ?? 0, schedules: r?.s ?? 0 };
}

/** Holds while no active transaction and no non-zero assigned amount refers to the categories. */
export function noHistory(budgetId: string, ids: readonly string[]): SQL {
  return sql`not exists (select 1 from transactions where budget_id = ${budgetId} and deleted_at is null and category_id in (${idList(ids)})) and not exists (select 1 from month_categories where budget_id = ${budgetId} and assigned <> 0 and category_id in (${idList(ids)}))`;
}

/** Holds while every category in `ids` is active. */
export function allActive(ids: readonly string[]): SQL {
  return sql`(select count(*) from ${categories} where ${categories.id} in (${idList(ids)}) and ${categories.deletedAt} is null) = ${ids.length}`;
}

/** Holds while the category is active and so is its group. */
export function activeInActiveGroup(budgetId: string, id: string): SQL {
  return sql`exists (select 1 from ${categories} c join ${categoryGroups} g on g.id = c.group_id where c.id = ${id} and c.budget_id = ${budgetId} and c.deleted_at is null and g.deleted_at is null)`;
}

/** The live payment category of a credit account (EXF-532), or undefined. */
export async function findPaymentCategory(
  db: Db,
  accountId: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.accountId, accountId), isNull(categories.deletedAt)))
    .limit(1);
  return row;
}

/** `categoryJson()` plus the payment category's `kind` and `account_id`. */
export const paymentCategoryJson = (): SQL =>
  sql`json_object('id', id, 'budget_id', budget_id, 'group_id', group_id, 'name', name, 'sort', sort_order, 'hidden', ${jsonBool(sql`hidden`)}, 'note', note, 'kind', kind, 'account_id', account_id)`;

// EXF-496: move (reorder) statements. The plan rides ONE json parameter, so the statements and the bound
// parameters do not grow with the rows.

/** One row of a move's JSON: `i` id, `o`/`g` the sort_order and group_id that were read, `n` the new sort_order,
 *  `d` the destination group, `w` 1 when the row is written (0: only checked, so a neighbour that moved is noticed). */
export interface MoveEntry {
  i: string;
  o: number;
  g: string;
  n: number;
  d: string;
  w: 0 | 1;
}

const jx = (path: string): SQL => sql.raw(`json_extract(j.value, '$.${path}')`);

/** Holds while every row in the JSON is still active with the `sort_order`/`group_id` that were read, the moved
 *  row still has the `updated_at` read, the destination group is active, and (cross-group) the name is free there. */
export function moveGuard(
  budgetId: string,
  json: string,
  moved: { id: string; updatedAt: string; name: string },
  dest: { id: string; crossGroup: boolean },
): SQL {
  return allOf(
    sql`not exists (select 1 from json_each(${json}) j left join ${categories} c on c.id = ${jx("i")} where c.id is null or c.deleted_at is not null or c.budget_id <> ${budgetId} or c.sort_order <> ${jx("o")} or c.group_id <> ${jx("g")})`,
    holds(moved.id, moved.updatedAt),
    sql`exists (select 1 from ${categoryGroups} where ${categoryGroups.id} = ${dest.id} and ${categoryGroups.budgetId} = ${budgetId} and ${categoryGroups.deletedAt} is null)`,
    dest.crossGroup ? nameFree(dest.id, moved.name, moved.id) : null,
  );
}

/** The written rows of the JSON as a `select` for `logSelectStmt` (columns of `categories` plus `jv`). */
export function moveInner(budgetId: string, json: string, guard: SQL): SQL {
  return sql`select c.*, j.value as jv from json_each(${json}) j join ${categories} c on c.id = ${jx("i")} where c.budget_id = ${budgetId} and ${jx("w")} = 1 and ${guard}`;
}

/** The log row's `after`: the category with the new sort and group. */
export const categoryMovedJson = (): SQL =>
  sql`json_set(${categoryJson()}, '$.sort', json_extract(jv, '$.n'), '$.group_id', json_extract(jv, '$.d'))`;

/** Writes `sort_order`, `group_id` and `updated_at` of the written rows of the JSON while `guard` holds. */
export function moveSortsStmt(db: Db, budgetId: string, json: string, now: string, guard: SQL) {
  const pick = (path: string): SQL =>
    sql`(select json_extract(j.value, ${`$.${path}`}) from json_each(${json}) j where json_extract(j.value, '$.i') = ${categories.id})`;
  return db
    .update(categories)
    .set({ sortOrder: pick("n"), groupId: pick("d"), updatedAt: now })
    .where(
      and(
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
        sql`${categories.id} in (select json_extract(j.value, '$.i') from json_each(${json}) j where json_extract(j.value, '$.w') = 1)`,
        guard,
      ),
    );
}
