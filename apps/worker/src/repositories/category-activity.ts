import type { Month } from "@budget/core/month";
import { addMonths } from "@budget/core/month";
import type { CategoryActivityRow } from "@budget/schema/category-activity";
import { transferPayeeName } from "@budget/schema/transfers";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";

export type ActiveCategory = { id: string; name: string; kind: "credit_card_payment" | null };

/** An active category of the plan (its group active too), or null. One statement. */
export async function findActiveCategory(
  db: Db,
  budgetId: string,
  categoryId: string,
): Promise<ActiveCategory | null> {
  const [row] = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .innerJoin(
      categoryGroups,
      and(eq(categoryGroups.id, categories.groupId), isNull(categoryGroups.deletedAt)),
    )
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  return row
    ? { id: row.id, name: row.name, kind: row.kind === "credit_card_payment" ? row.kind : null }
    : null;
}

type Raw = {
  id: string;
  parent_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  payee_name: string | null;
  transfer_name: string | null;
  memo: string | null;
  amount: number;
  total_count: number;
  activity: number;
};

/**
 * The transactions behind one ordinary category's Activity in one month, in one statement. It mirrors the
 * rule of `planActivity` (repositories/plan-activity.ts) and `classifyTransaction` (core budget-engine) for
 * rows that land in a category: an on-plan, active account (closed still counts), no Ready to Assign inflow,
 * no transfer between two on-plan accounts, no split parent with a live line. `total_count` and `activity`
 * are window aggregates, so they cover every row while `limit` bounds the rows sent.
 */
export async function categoryActivityRows(
  db: Db,
  budgetId: string,
  categoryId: string,
  month: Month,
  limit: number,
): Promise<{ rows: CategoryActivityRow[]; total: number; activity: number }> {
  const next = addMonths(month, 1);
  const raw = await db.all<Raw>(sql`
    select
      t.id as id,
      t.parent_transaction_id as parent_id,
      a.id as account_id,
      a.name as account_name,
      t.date as date,
      coalesce(py.name, t.payee_name, pp.name, p.payee_name) as payee_name,
      ta.name as transfer_name,
      t.memo as memo,
      t.amount as amount,
      count(*) over () as total_count,
      sum(t.amount) over () as activity
    from transactions t
    inner join accounts a on a.id = t.account_id and a.deleted_at is null and a.on_budget = 1
    left join accounts ta on ta.id = t.transfer_account_id
    left join payees py on py.id = t.payee_id
    left join transactions p on p.id = t.parent_transaction_id
    left join payees pp on pp.id = p.payee_id
    where t.budget_id = ${budgetId}
      and t.deleted_at is null
      and t.category_id = ${categoryId}
      and t.date >= ${month} and t.date < ${next}
      and t.inflow_to_ready_to_assign = 0
      and not (t.transfer_account_id is not null and coalesce(ta.on_budget, 0) = 1)
      and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
    order by t.date desc, t.amount asc, t.created_at asc, coalesce(t.split_index, -1) asc, t.id asc
    limit ${limit}
  `);
  const first = raw[0];
  return {
    rows: raw.map((r) => ({
      id: r.parent_id ?? r.id,
      subtransaction_id: r.parent_id ? r.id : null,
      account_id: r.account_id,
      account_name: r.account_name,
      date: r.date,
      payee_name: r.transfer_name !== null ? transferPayeeName(r.transfer_name) : r.payee_name,
      memo: r.memo,
      amount: r.amount,
    })),
    total: first?.total_count ?? 0,
    activity: first?.activity ?? 0,
  };
}
