import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

export type MoveRow = {
  id: string;
  at: string;
  actor: string;
  move_id: string | null;
  move_kind: string | null;
  move_undo_of: string | null;
  from_id: string | null;
  to_id: string | null;
  month: string;
  amount: number;
  undo_of: string | null;
  auto_assign: number;
  from_name: string | null;
  from_deleted: number | null;
  to_name: string | null;
  to_deleted: number | null;
  /** 1 when `undo_of` is an odd number of undo steps away: this row redoes. */
  redo: number;
};

/**
 * The plan's Assigned changes since `since`, in one statement. The rows of one move (`after.move.id`) are
 * reduced to its first row, with `at` the earliest `created_at`; any other row is one entry with its delta
 * (after − before) and a zero delta is dropped. `filter.month` / `filter.categoryId` keep a month's cells / the entries
 * to or from a category (a move whole); a null `since` has no time bound. `redo` is 1 when the row's `undo_of` is an
 * odd number of undo steps (through `change_set_undos`) from a set that is not an undo: a redo is the undo of an undo. The rows of a category-delete merge (`reassigned_from`) are
 * not changes the person made and are skipped. Category names (deleted ones too) come from a left join.
 */
export async function listMoveRows(
  db: Db,
  budgetId: string,
  since: string | null,
  filter: { month?: string; categoryId?: string } = {},
): Promise<MoveRow[]> {
  const bySince = since === null ? sql`` : sql`and l.created_at >= ${since}`;
  const month = filter.month ?? null;
  const cid = filter.categoryId ?? null;
  return db.all<MoveRow>(sql`
    with recursive r as (
      select
        l.id as id, l.actor as actor, l.created_at as created_at,
        json_extract(l.after_json, '$.move.id') as move_id,
        json_extract(l.after_json, '$.move.kind') as move_kind,
        json_extract(l.after_json, '$.move.undo_of') as move_undo_of,
        json_extract(l.after_json, '$.move.from_category_id') as mv_from,
        json_extract(l.after_json, '$.move.to_category_id') as mv_to,
        json_extract(l.after_json, '$.move.month') as mv_month,
        json_extract(l.after_json, '$.move.amount') as mv_amount,
        json_extract(l.after_json, '$.category_id') as cell_category,
        json_extract(l.after_json, '$.month') as cell_month,
        coalesce(json_extract(l.after_json, '$.assigned'), 0) - coalesce(json_extract(l.before_json, '$.assigned'), 0) as delta,
        json_extract(l.after_json, '$.undo_of') as undo_of,
        json_extract(l.after_json, '$.auto_assign.id') is not null as auto_assign
      from change_log l
      where l.budget_id = ${budgetId}
        and l.entity_type = 'month_category'
        ${bySince}
        and json_extract(l.after_json, '$.reassigned_from') is null
        and json_extract(l.before_json, '$.reassigned_from') is null
    ), f as (
      select * from r
      where (${month} is null or coalesce(mv_month, cell_month) = ${month})
        and (${cid} is null or case when move_id is not null then (mv_from = ${cid} or mv_to = ${cid}) else cell_category = ${cid} end)
    ), ranked as (
      select r.*,
        row_number() over (partition by coalesce(r.move_id, r.id) order by r.created_at, r.id) as rn,
        min(r.created_at) over (partition by coalesce(r.move_id, r.id)) as at
      from f r
      where r.move_id is not null or r.delta <> 0
    ), chain(start, cur, depth) as (
      select distinct undo_of, undo_of, 0 from f where undo_of is not null
      union all
      select chain.start, u.change_set_id, chain.depth + 1
      from chain
      join change_set_undos u on u.budget_id = ${budgetId} and u.undo_change_set_id = chain.cur
    ), rd as (
      select start, max(depth) % 2 as redo from chain group by start
    )
    select
      coalesce(k.move_id, k.id) as id,
      k.at as at,
      k.actor as actor,
      k.move_id as move_id,
      k.move_kind as move_kind,
      k.move_undo_of as move_undo_of,
      case when k.move_id is not null then k.mv_from when k.delta < 0 then k.cell_category end as from_id,
      case when k.move_id is not null then k.mv_to when k.delta > 0 then k.cell_category end as to_id,
      case when k.move_id is not null then k.mv_month else k.cell_month end as month,
      case when k.move_id is not null then k.mv_amount else abs(k.delta) end as amount,
      k.undo_of as undo_of,
      k.auto_assign as auto_assign,
      cf.name as from_name, cf.deleted_at is not null as from_deleted,
      ct.name as to_name, ct.deleted_at is not null as to_deleted,
      coalesce(rd.redo, 0) as redo
    from ranked k
    left join rd on rd.start = k.undo_of
    left join categories cf on cf.id = case when k.move_id is not null then k.mv_from when k.delta < 0 then k.cell_category end
    left join categories ct on ct.id = case when k.move_id is not null then k.mv_to when k.delta > 0 then k.cell_category end
    where k.rn = 1
    order by k.at desc, coalesce(k.move_id, k.id) desc
  `);
}
