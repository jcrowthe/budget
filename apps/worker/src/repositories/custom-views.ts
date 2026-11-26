import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { changeLog } from "../db/schema/change-log";
import { planViews } from "../db/schema/plan-views";
import { changeLogInsertIf } from "../history/change-log";
import { currentChangeSetId } from "../history/change-set";
import { insertSelect } from "./insert-select";

/** One live view row; `live_ids` is the stored set narrowed to categories that still exist (JSON, stored order). */
export interface ViewListRow {
  view_id: string;
  builtin_key: string | null;
  view_name: string | null;
  stored_ids: string;
  live_ids: string;
  view_sort_order: number;
  view_created_at: string;
  view_updated_at: string;
}

/**
 * UNEXECUTED: the plan's live view rows (custom views and saved built-in positions), columns labelled. A deleted
 * category, or one in a deleted group, drops out of `live_ids` here; hidden ones stay. One statement, no IN list.
 */
export function listStmt(db: Db, budgetId: string, viewId?: string) {
  return db.all<ViewListRow>(sql`
    select v.id as view_id, v.builtin_key as builtin_key, v.name as view_name, v.category_ids as stored_ids,
      coalesce((select json_group_array(m.cid) from (
        select j.value as cid from json_each(v.category_ids) j
        join categories c on c.id = j.value and c.budget_id = v.budget_id and c.deleted_at is null
        join category_groups g on g.id = c.group_id and g.deleted_at is null
        order by j.key) m), '[]') as live_ids,
      v.sort_order as view_sort_order, v.created_at as view_created_at, v.updated_at as view_updated_at
    from plan_views v
    where v.budget_id = ${budgetId} and v.deleted_at is null
      ${viewId === undefined ? sql`` : sql`and v.id = ${viewId} and v.builtin_key is null`}
    order by v.sort_order, v.id`);
}

/** UNEXECUTED: how many of the (distinct) ids are live categories of the plan, in live groups. */
export function liveCategoryCountStmt(db: Db, budgetId: string, idsJson: string) {
  return db.all<{ n: number }>(sql`
    select count(*) as n from categories c
    join category_groups g on g.id = c.group_id and g.deleted_at is null
    where c.budget_id = ${budgetId} and c.deleted_at is null
      and c.id in (select value from json_each(${idsJson}))`);
}

export const viewLog = (v: { name: string; category_ids: string[]; sort_order: number }) => ({
  name: v.name,
  category_ids: v.category_ids,
  sort_order: v.sort_order,
});

/**
 * UNEXECUTED: inserts a custom view last in the plan's order (sort_order computed in the statement itself).
 * Put `createLogStmt` right after it in the same batch.
 */
export function insertStmt(
  db: Db,
  row: { id: string; budgetId: string; name: string; categoryIds: string; now: string },
) {
  return insertSelect(
    db,
    planViews,
    {
      id: row.id,
      budgetId: row.budgetId,
      builtinKey: null,
      name: row.name,
      categoryIds: row.categoryIds,
      sortOrder: sql`coalesce((select max(sort_order) from plan_views where budget_id = ${row.budgetId} and deleted_at is null), -1) + 1`,
      createdAt: row.now,
      updatedAt: row.now,
      deletedAt: null,
    },
    sql`where exists (select 1 from budgets where id = ${row.budgetId} and deleted_at is null)`,
  );
}

/** UNEXECUTED: the create's change_log row, its `after` read from the inserted row (so it holds the sort_order). */
export function createLogStmt(db: Db, budgetId: string, actor: string, id: string) {
  return insertSelect(
    db,
    changeLog,
    {
      id: crypto.randomUUID(),
      budgetId,
      actor,
      action: "create",
      entityType: "plan_view",
      entityId: id,
      beforeJson: null,
      afterJson: sql`(select json_object('name', name, 'category_ids', json(category_ids), 'sort_order', sort_order) from plan_views where id = ${id})`,
      createdAt: new Date().toISOString(),
      changeSetId: currentChangeSetId(),
    },
    sql`where exists (select 1 from plan_views where id = ${id})`,
  );
}

/** A condition: the custom view is live and still has the `updated_at` that was read. */
export const unchangedGuard = (id: string, updatedAt: string) =>
  sql`(select 1 from plan_views where id = ${id} and deleted_at is null and updated_at = ${updatedAt})`;

export function guardedLog(
  db: Db,
  e: {
    budgetId: string;
    actor: string;
    action: "update" | "delete";
    id: string;
    before: unknown;
    after: unknown;
  },
  updatedAt: string,
) {
  return changeLogInsertIf(
    db,
    {
      budgetId: e.budgetId,
      actor: e.actor,
      action: e.action,
      entityType: "plan_view",
      entityId: e.id,
      before: e.before,
      after: e.after,
    },
    unchangedGuard(e.id, updatedAt),
  );
}

export function updateStmt(
  db: Db,
  id: string,
  updatedAt: string,
  set: { name?: string; categoryIds?: string },
  now: string,
) {
  return db
    .update(planViews)
    .set({ ...set, updatedAt: now })
    .where(
      and(eq(planViews.id, id), isNull(planViews.deletedAt), eq(planViews.updatedAt, updatedAt)),
    );
}

export function softDeleteStmt(db: Db, id: string, updatedAt: string, now: string) {
  return db
    .update(planViews)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(planViews.id, id), isNull(planViews.deletedAt), eq(planViews.updatedAt, updatedAt)),
    );
}

/** UNEXECUTED: positions of the live custom views named in `idsJson` (their index in it). */
export function reorderCustomStmt(db: Db, budgetId: string, idsJson: string) {
  return db.run(sql`
    update plan_views
    set sort_order = (select j.key from json_each(${idsJson}) j where j.value = plan_views.id)
    where budget_id = ${budgetId} and deleted_at is null and builtin_key is null
      and id in (select value from json_each(${idsJson}))`);
}

/** UNEXECUTED: saves the four built-in positions (an upsert of their rows) from their index in `idsJson`. */
export function reorderBuiltinsStmt(db: Db, budgetId: string, idsJson: string, now: string) {
  return db.run(sql`
    insert into plan_views (id, budget_id, builtin_key, name, category_ids, sort_order, created_at, updated_at)
    select 'builtin:' || ${budgetId} || ':' || j.value, ${budgetId}, j.value, null, '[]', j.key, ${now}, ${now}
    from json_each(${idsJson}) j
    where j.value in ('underfunded', 'overfunded', 'money_available', 'snoozed')
    on conflict(id) do update set sort_order = excluded.sort_order, updated_at = excluded.updated_at, deleted_at = null`);
}
