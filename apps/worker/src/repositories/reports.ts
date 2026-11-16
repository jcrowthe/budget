import { ACCOUNT_TYPES, type AccountType, accountGroup } from "@budget/core/account-types";
import type { AgeRow } from "@budget/schema/age-of-money";

type Month = string;

import type { IncomeRow } from "@budget/schema/income-expense";
import type { MonthlySum } from "@budget/schema/net-worth";
import type { SpendingRow } from "@budget/schema/spending-breakdown";
import { transferPayeeName } from "@budget/schema/transfers";
import { and, asc, eq, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { transactions } from "../db/schema/transactions";
import { countsInBalance } from "./transactions";

const CASH_TYPES = ACCOUNT_TYPES.filter((t) => accountGroup(t) === "cash");

export interface ReportAccount {
  id: string;
  name: string;
  type: AccountType;
  onBudget: boolean;
  closed: boolean;
  starred: boolean;
  sortOrder: number;
}

export async function reportAccounts(db: Db, budgetId: string): Promise<ReportAccount[]> {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      onBudget: accounts.onBudget,
      closed: accounts.closed,
      starred: accounts.starred,
      sortOrder: accounts.sortOrder,
    })
    .from(accounts)
    .where(and(eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)))
    .orderBy(asc(accounts.sortOrder));
}

/** Transactions of the plan that count: not deleted, on an account that is not deleted. */
const live = (budgetId: string) =>
  and(
    eq(transactions.budgetId, budgetId),
    isNull(transactions.deletedAt),
    sql`${transactions.accountId} in (select id from accounts where budget_id = ${budgetId} and deleted_at is null)`,
  );

export async function earliestTransactionMonth(db: Db, budgetId: string): Promise<Month | null> {
  const [row] = await db
    .select({ m: sql<string | null>`min(substr(${transactions.date}, 1, 7))` })
    .from(transactions)
    .where(live(budgetId));
  return row?.m ? `${row.m}-01` : null;
}

/** Sums per account and month for transactions dated before `beforeDate` (YYYY-MM-DD). */
export async function monthlySums(
  db: Db,
  budgetId: string,
  beforeDate: string,
): Promise<MonthlySum[]> {
  const month = sql<string>`substr(${transactions.date}, 1, 7)`;
  const rows = await db
    .select({
      account_id: transactions.accountId,
      month,
      amount: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    // Split lines are left out: the parent row carries the split's whole amount. Both transfer sides stay in.
    .where(
      and(
        live(budgetId),
        isNull(transactions.parentTransactionId),
        lt(transactions.date, beforeDate),
      ),
    )
    .groupBy(transactions.accountId, month);
  return rows.map((r) => ({ account_id: r.account_id, month: `${r.month}-01`, amount: r.amount }));
}

interface SpendingRaw {
  id: string;
  parent_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  created_at: string;
  split_index: number | null;
  amount: number;
  transfer_name: string | null;
  payee_name: string | null;
  memo: string | null;
  cleared: SpendingRow["cleared"];
  category_id: string | null;
  category_name: string | null;
  category_hidden: number | null;
  category_order: number | null;
  group_id: string | null;
  group_name: string | null;
  group_hidden: number | null;
  group_order: number | null;
}

/**
 * THE SPENDING RULE (one place). A counted row is a non-deleted transaction of the plan that:
 * - is on a non-deleted on-plan account, dated in [start, endBefore);
 * - is not a split parent (a row with a live line); a line counts when its parent is not deleted;
 * - is not a transfer to another on-plan account (a transfer to a tracking or loan account counts);
 * - is not an inflow to Ready to Assign and not a Starting Balance.
 * It belongs to its own category (hidden and deleted categories included), or to Uncategorized when it has none.
 * Excluded categories and accounts are applied by the caller.
 */
export async function spendingRows(
  db: Db,
  budgetId: string,
  range: { start: Month; endBefore: string },
): Promise<SpendingRow[]> {
  const rows = await db.all<SpendingRaw>(sql`
    select t.id as id, t.parent_transaction_id as parent_id, t.account_id as account_id, a.name as account_name,
      t.date as date, t.created_at as created_at, t.split_index as split_index, t.amount as amount,
      ta.name as transfer_name,
      coalesce(py.name, t.payee_name, pp.name, p.payee_name) as payee_name,
      t.memo as memo, coalesce(p.cleared, t.cleared) as cleared,
      t.category_id as category_id, c.name as category_name, c.hidden as category_hidden,
      c.sort_order as category_order, g.id as group_id, g.name as group_name, g.hidden as group_hidden,
      g.sort_order as group_order
    from transactions t
    join accounts a on a.id = t.account_id and a.budget_id = ${budgetId} and a.deleted_at is null and a.on_budget = 1
    left join transactions p on p.id = t.parent_transaction_id
    left join accounts ta on ta.id = t.transfer_account_id
    left join payees py on py.id = t.payee_id
    left join payees pp on pp.id = p.payee_id
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where t.budget_id = ${budgetId} and t.deleted_at is null
      and t.date >= ${range.start} and t.date < ${range.endBefore}
      and (t.parent_transaction_id is null or p.deleted_at is null)
      and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
      and not (t.transfer_account_id is not null and coalesce(ta.on_budget, 0) = 1)
      and t.inflow_to_ready_to_assign = 0
      and coalesce(py.system, '') <> 'starting_balance'
  `);
  return rows.map((r) => ({
    id: r.id,
    transaction_id: r.parent_id ?? r.id,
    subtransaction_id: r.parent_id ? r.id : null,
    account_id: r.account_id,
    account_name: r.account_name,
    date: r.date,
    created_at: r.created_at,
    split_index: r.split_index,
    amount: r.amount,
    payee_name: r.transfer_name !== null ? transferPayeeName(r.transfer_name) : r.payee_name,
    memo: r.memo,
    cleared: r.cleared,
    category_id: r.category_id,
    category_name: r.category_name,
    category_hidden: !!r.category_hidden,
    category_order: r.category_id ? (r.category_order ?? 0) : 0,
    group_id: r.group_id,
    group_name: r.group_name,
    group_hidden: !!r.group_hidden,
    group_order: r.category_id ? (r.group_order ?? 0) : 0,
  }));
}

/** The name of a category or group of the plan (deleted ones included), or null when the plan has none. */
export async function findCategoryOrGroup(
  db: Db,
  budgetId: string,
  kind: "category" | "group",
  id: string,
): Promise<string | null> {
  const rows = await db.all<{ name: string }>(
    kind === "category"
      ? sql`select name from categories where id = ${id} and budget_id = ${budgetId}`
      : sql`select name from category_groups where id = ${id} and budget_id = ${budgetId}`,
  );
  return rows[0]?.name ?? null;
}

interface IncomeRaw {
  id: string;
  parent_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  created_at: string;
  split_index: number | null;
  amount: number;
  payee_id: string | null;
  payee_name: string | null;
  memo: string | null;
  cleared: IncomeRow["cleared"];
}

/**
 * THE INCOME RULE (one place). An income row is a non-deleted transaction of the plan that:
 * - is on a non-deleted on-plan account (closed ones included), dated in [start, endBefore);
 * - is not a split parent; a line counts when its parent is not deleted;
 * - has inflow_to_ready_to_assign set, whatever its sign (a balance adjustment is negative when it is negative);
 * - is not a transfer, and its payee is not the Starting Balance system payee.
 * Its payee is the line's own when it has one, else the split's; a row with no payee has payee_id null.
 * Excluded accounts are applied by the caller; the category filter never applies to income.
 */
export async function incomeRows(
  db: Db,
  budgetId: string,
  range: { start: Month; endBefore: string },
): Promise<IncomeRow[]> {
  const rows = await db.all<IncomeRaw>(sql`
    select t.id as id, t.parent_transaction_id as parent_id, t.account_id as account_id, a.name as account_name,
      t.date as date, t.created_at as created_at, t.split_index as split_index, t.amount as amount,
      case when t.payee_id is not null or t.payee_name is not null then t.payee_id else p.payee_id end as payee_id,
      coalesce(py.name, t.payee_name, pp.name, p.payee_name) as payee_name,
      t.memo as memo, coalesce(p.cleared, t.cleared) as cleared
    from transactions t
    join accounts a on a.id = t.account_id and a.budget_id = ${budgetId} and a.deleted_at is null and a.on_budget = 1
    left join transactions p on p.id = t.parent_transaction_id
    left join payees py on py.id = t.payee_id
    left join payees pp on pp.id = p.payee_id
      and t.payee_id is null and t.payee_name is null
    where t.budget_id = ${budgetId} and t.deleted_at is null
      and t.date >= ${range.start} and t.date < ${range.endBefore}
      and (t.parent_transaction_id is null or p.deleted_at is null)
      and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
      and t.inflow_to_ready_to_assign = 1
      and t.transfer_account_id is null
      and coalesce(py.system, pp.system, '') <> 'starting_balance'
  `);
  return rows.map((r) => ({
    id: r.id,
    transaction_id: r.parent_id ?? r.id,
    subtransaction_id: r.parent_id ? r.id : null,
    account_id: r.account_id,
    account_name: r.account_name,
    date: r.date,
    created_at: r.created_at,
    split_index: r.split_index,
    amount: r.amount,
    payee_id: r.payee_id,
    payee_name: r.payee_name,
    memo: r.memo,
    cleared: r.cleared,
  }));
}

/** The name of a payee of the plan (deleted ones included), or null when the plan has none. */
export async function findPayee(db: Db, budgetId: string, id: string): Promise<string | null> {
  const rows = await db.all<{ name: string }>(
    sql`select name from payees where id = ${id} and budget_id = ${budgetId}`,
  );
  return rows[0]?.name ?? null;
}

/**
 * THE AGE OF MONEY ROWS (one place). One query returns the plan's whole history of rows that Age of Money needs:
 * rows that count in a balance (`countsInBalance`: not deleted, not a split line) on accounts that are not deleted,
 * on-plan and of a cash type (checking, savings, cash; closed ones included), dated on or before `today`, amount
 * not 0. Five columns, ordered by date, creation time and id; a ten-year plan is about 24,000 rows in one query.
 */
export async function ageOfMoneyRows(db: Db, budgetId: string, today: string): Promise<AgeRow[]> {
  return db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      account_id: transactions.accountId,
      transfer_account_id: transactions.transferAccountId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        countsInBalance(),
        lte(transactions.date, today),
        ne(transactions.amount, 0),
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        eq(accounts.onBudget, true),
        inArray(accounts.type, CASH_TYPES),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id));
}
