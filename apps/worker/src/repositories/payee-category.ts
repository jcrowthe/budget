import { RECENCY_ORDER } from "@budget/schema/payee-category";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { payees } from "../db/schema/payees";
import { whenQuery } from "./guards";
import { idsIn } from "./payees";

/**
 * The payee's remembered category (EXF-515). Definitions: docs/payee-category-design.md.
 * The counted-row rule and the recency order below are the single source for the SQL; the migration
 * `20261116101900_payee_category.sql` copies them as literal SQL.
 */

/** `t.date desc, t.created_at asc, t.id asc`, built from the one `RECENCY_ORDER` constant (names are constants). */
export const recencyOrderSql = (alias: string): SQL =>
  sql.raw(RECENCY_ORDER.map((o) => `${alias}.${o.column} ${o.dir}`).join(", "));

/**
 * A condition: the category `expr` is live in the plan: not deleted, its group not deleted. The same rule as
 * `categoriesRepo.findActive`, which every transaction's `validate` uses.
 */
export const liveCategorySql = (budgetId: string, expr: SQL | string): SQL =>
  sql`exists (select 1 from categories c join category_groups g on g.id = c.group_id and g.deleted_at is null where c.id = ${typeof expr === "string" ? sql.raw(expr) : expr} and c.budget_id = ${budgetId} and c.deleted_at is null)`;

/** The `from … where …` of a payee's counted rows (alias `t`); the caller adds the payee condition. */
const countedFrom = (budgetId: string, joins: SQL = sql``): SQL => sql`from transactions t
    join accounts a on a.id = t.account_id and a.deleted_at is null
    ${joins}
    where t.budget_id = ${budgetId} and t.deleted_at is null and t.parent_transaction_id is null
    and t.transfer_account_id is null
    and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
    and (t.inflow_to_ready_to_assign = 1 or ${liveCategorySql(budgetId, "t.category_id")})`;

/** The category a counted row remembers: none for Ready to Assign. */
const valueCid = sql.raw(
  "case when t.inflow_to_ready_to_assign = 1 then null else t.category_id end",
);

/** A condition: the live category of the stored default, or Ready to Assign. */
const currentLive = (budgetId: string, alias: string): SQL =>
  sql`(${sql.raw(alias)}.default_inflow_to_ready_to_assign = 1 or (${sql.raw(alias)}.default_category_id is not null and ${liveCategorySql(budgetId, `${alias}.default_category_id`)}))`;

/**
 * One idempotent UPDATE that sets `default_category_id` / `default_inflow_to_ready_to_assign` of the live ordinary
 * payees among `payeeIds` (or of the whole plan) to `nextDefault(stored if live, last 3 counted rows)`, and only
 * where that differs from what is stored. It leaves `updated_at` alone and writes no change_log row. Returns null
 * when no payee is named, so the caller does not batch an empty statement.
 */
export function recomputeDefaultsStmt(
  db: Db,
  budgetId: string,
  payeeIds: readonly (string | null | undefined)[] | "plan",
) {
  let rowsOf: SQL;
  let payeesOf: SQL;
  if (payeeIds === "plan") {
    rowsOf = sql`1`;
    payeesOf = sql`1`;
  } else {
    const ids = [...new Set(payeeIds.filter((i): i is string => !!i))];
    if (ids.length === 0) return null;
    rowsOf = idsIn(sql.raw("t.payee_id"), ids);
    payeesOf = idsIn(sql.raw("p.id"), ids);
  }
  // `from (...)` is a derived table (D1 batches only builder statements, so no WITH): the last 3 counted rows
  // per payee give the majority `m` (a value held by at least 2) and the most recent `f`.
  const nv = sql`(
    select p.id as pid,
      case when m.payee_id is not null then m.cid
           when ${currentLive(budgetId, "p")} then p.default_category_id
           else f.cid end as cid,
      case when m.payee_id is not null then m.rta
           when ${currentLive(budgetId, "p")} then p.default_inflow_to_ready_to_assign
           else coalesce(f.rta, 0) end as rta
    from payees p
    left join (
      select payee_id, cid, rta from (
        select t.payee_id as payee_id, ${valueCid} as cid, t.inflow_to_ready_to_assign as rta,
          row_number() over (partition by t.payee_id order by ${recencyOrderSql("t")}) as rn
        ${countedFrom(budgetId)} and ${rowsOf}
      ) where rn <= 3 group by payee_id, cid, rta having count(*) >= 2
    ) m on m.payee_id = p.id
    left join (
      select payee_id, cid, rta from (
        select t.payee_id as payee_id, ${valueCid} as cid, t.inflow_to_ready_to_assign as rta,
          row_number() over (partition by t.payee_id order by ${recencyOrderSql("t")}) as rn
        ${countedFrom(budgetId)} and ${rowsOf}
      ) where rn = 1
    ) f on f.payee_id = p.id
    where p.budget_id = ${budgetId} and p.deleted_at is null and p.system is null and ${payeesOf}
  ) nv`;
  return db
    .update(payees)
    .set({ defaultCategoryId: sql`nv.cid`, defaultInflowToReadyToAssign: sql`nv.rta` })
    .from(nv)
    .where(
      sql`payees.id = nv.pid and (nv.cid is not payees.default_category_id or nv.rta is not payees.default_inflow_to_ready_to_assign)`,
    );
}

/**
 * The payee's n-th counted row in recency order (`offset` 0 is the newest) as a JSON `{ c, r }` (category id or
 * null, Ready to Assign 0/1), or null when there is none. Three of them give a payee's last 3 in one select.
 */
export function recentValueSql(budgetId: string, payeeRef: string, offset: number): SQL {
  return sql`(select json_object('c', ${valueCid}, 'r', t.inflow_to_ready_to_assign) ${countedFrom(budgetId)}
      and t.payee_id = ${sql.raw(payeeRef)} order by ${recencyOrderSql("t")} limit 1 offset ${sql.raw(String(offset))})`;
}

export type RecentCounted = {
  id: string;
  account_id: string;
  date: string;
  category_id: string | null;
  category_name: string | null;
  category_group_name: string | null;
  inflow: number;
  amount: number;
};

/** A payee's first `limit` counted rows in recency order, with the category and group names. One D1 call. */
export function recentCountedQuery(
  db: Db,
  budgetId: string,
  payeeId: string,
  limit: number,
): Promise<RecentCounted[]> {
  return db.all<RecentCounted>(sql`
    select t.id, t.account_id, t.date, ${valueCid} as category_id, c.name as category_name,
      g.name as category_group_name, t.inflow_to_ready_to_assign as inflow, t.amount
    ${countedFrom(budgetId, sql`left join categories c on c.id = t.category_id left join category_groups g on g.id = c.group_id`)}
    and t.payee_id = ${payeeId}
    order by ${recencyOrderSql("t")}
    limit ${limit}`);
}

/** An unexecuted query that yields a row while the category is live in the plan (rides a `db.batch` of reads). */
export const liveCategoryQuery = (db: Db, budgetId: string, id: string) =>
  whenQuery(db, liveCategorySql(budgetId, sql`${id}`));
