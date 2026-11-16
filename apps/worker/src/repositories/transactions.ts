import {
  ACCOUNT_TYPES,
  isOnBudget,
  STARTING_BALANCE_PAYEE,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import type { EngineActivity } from "@budget/core/budget-engine";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  not,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { changeLog } from "../db/schema/change-log";
import { transactions } from "../db/schema/transactions";

export type TransactionRow = typeof transactions.$inferSelect;

export function insertStmt(db: Db, row: TransactionRow) {
  return db.insert(transactions).values(row);
}

/** Inserts the row only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: TransactionRow, guard: SQLWrapper) {
  const r = row;
  return db
    .insert(transactions)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.accountId}, ${r.date}, ${r.payeeName}, ${r.categoryId}, ${r.inflowToReadyToAssign ? 1 : 0}, ${r.memo}, ${r.amount}, ${r.cleared}, ${r.approved ? 1 : 0}, ${r.createdAt}, ${r.deletedAt} where exists ${guard}`,
    );
}

/** Per account: the sum of cleared (and reconciled) and of uncleared active transactions. */
export async function balancesByAccount(
  db: Db,
  budgetId: string,
  accountId?: string,
): Promise<Map<string, { cleared: number; uncleared: number }>> {
  const conds = [eq(transactions.budgetId, budgetId), isNull(transactions.deletedAt)];
  if (accountId) conds.push(eq(transactions.accountId, accountId));
  const rows = await db
    .select({
      accountId: transactions.accountId,
      cleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then 0 else ${transactions.amount} end), 0)`,
      uncleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.accountId);
  return new Map(rows.map((r) => [r.accountId, { cleared: r.cleared, uncleared: r.uncleared }]));
}

// A new credit account's Starting Balance is on-plan with no category and no Ready to Assign flag, which the
// engine would count as uncategorized activity. Left out until EXF-532 (payment categories) replaces this.
const UNCOUNTED_STARTING_TYPES = ACCOUNT_TYPES.filter(
  (t) => isOnBudget(t) && !startingBalanceFeedsReadyToAssign(t),
);

/**
 * Active transactions on active accounts dated before `before`, summed per month, category, inflow flag and
 * account (on_budget, type). `date` is the month's first day, which the engine reads like any date.
 */
export async function activityByMonth(
  db: Db,
  budgetId: string,
  before: string,
): Promise<EngineActivity[]> {
  const ym = sql<string>`substr(${transactions.date}, 1, 7)`;
  const rows = await db
    .select({
      ym,
      amount: sql<number>`sum(${transactions.amount})`,
      categoryId: transactions.categoryId,
      inflow: transactions.inflowToReadyToAssign,
      onBudget: accounts.onBudget,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        lt(transactions.date, before),
        not(
          and(
            inArray(accounts.type, UNCOUNTED_STARTING_TYPES),
            // null-safe: a payee-less row must not make the whole NOT(...) NULL and drop out of the WHERE
            sql`coalesce(${transactions.payeeName}, '') = ${STARTING_BALANCE_PAYEE}`,
            isNull(transactions.categoryId),
            eq(transactions.inflowToReadyToAssign, false),
          ) as SQLWrapper,
        ),
      ),
    )
    .groupBy(
      ym,
      transactions.categoryId,
      transactions.inflowToReadyToAssign,
      accounts.onBudget,
      accounts.type,
    );
  return rows.map((r) => ({
    date: `${r.ym}-01`,
    amount: r.amount,
    categoryId: r.categoryId,
    inflowToReadyToAssign: r.inflow,
    onBudget: r.onBudget,
    accountType: r.accountType,
  }));
}

export type TransactionDetailRow = TransactionRow & {
  categoryName: string | null;
  groupName: string | null;
};

// Soft-deleted categories and groups still join, so an old row keeps its label.
const detailSelect = (db: Db) =>
  db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId));

const toDetail = (r: {
  t: TransactionRow;
  categoryName: string | null;
  groupName: string | null;
}): TransactionDetailRow => ({ ...r.t, categoryName: r.categoryName, groupName: r.groupName });

export async function findDetail(
  db: Db,
  budgetId: string,
  id: string,
): Promise<TransactionDetailRow | undefined> {
  const [row] = await detailSelect(db)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  return row ? toDetail(row) : undefined;
}

/** The account's non-deleted transactions dated `sinceDate` or later, in no particular order. */
export async function listDetailForAccount(
  db: Db,
  budgetId: string,
  accountId: string,
  sinceDate?: string,
): Promise<TransactionDetailRow[]> {
  const conds = [
    eq(transactions.budgetId, budgetId),
    eq(transactions.accountId, accountId),
    isNull(transactions.deletedAt),
  ];
  if (sinceDate) conds.push(gte(transactions.date, sinceDate));
  return (await detailSelect(db).where(and(...conds))).map(toDetail);
}

/** Newest change_log time per transaction id (of one id when given). One grouped query: no IN list. */
export async function lastChangedAt(
  db: Db,
  budgetId: string,
  id?: string,
): Promise<Map<string, string>> {
  const conds = [eq(changeLog.budgetId, budgetId), eq(changeLog.entityType, "transaction")];
  if (id) conds.push(eq(changeLog.entityId, id));
  const rows = await db
    .select({ id: changeLog.entityId, at: sql<string>`max(${changeLog.createdAt})` })
    .from(changeLog)
    .where(and(...conds))
    .groupBy(changeLog.entityId);
  return new Map(rows.map((r) => [r.id, r.at]));
}

const same = (col: SQLWrapper, v: string | number | boolean | null) =>
  sql`${col} is ${typeof v === "boolean" ? (v ? 1 : 0) : v}`;

function holdsCondition(before: TransactionRow) {
  const t = transactions;
  return and(
    eq(t.id, before.id),
    isNull(t.deletedAt),
    same(t.accountId, before.accountId),
    same(t.date, before.date),
    same(t.payeeName, before.payeeName),
    same(t.categoryId, before.categoryId),
    same(t.inflowToReadyToAssign, before.inflowToReadyToAssign),
    same(t.memo, before.memo),
    same(t.amount, before.amount),
    same(t.cleared, before.cleared),
    same(t.approved, before.approved),
  ) as SQL;
}

/** A `SELECT 1` that holds while the row still has every value of `before` and is not deleted. */
export function holds(db: Db, before: TransactionRow) {
  return db.select({ x: sql`1` }).from(transactions).where(holdsCondition(before));
}

export function updateIfHoldsStmt(db: Db, before: TransactionRow, after: TransactionRow) {
  return db
    .update(transactions)
    .set({
      accountId: after.accountId,
      date: after.date,
      payeeName: after.payeeName,
      categoryId: after.categoryId,
      inflowToReadyToAssign: after.inflowToReadyToAssign,
      memo: after.memo,
      amount: after.amount,
      cleared: after.cleared,
      approved: after.approved,
    })
    .where(holdsCondition(before));
}

export function softDeleteIfHoldsStmt(db: Db, before: TransactionRow, deletedAt: string) {
  return db.update(transactions).set({ deletedAt }).where(holdsCondition(before));
}

/** The name of a category's group (deleted or not), for the change_log copy of a row. */
export async function groupNameOfCategory(db: Db, categoryId: string): Promise<string | null> {
  const [r] = await db
    .select({ name: categoryGroups.name })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(eq(categories.id, categoryId))
    .limit(1);
  return r?.name ?? null;
}
