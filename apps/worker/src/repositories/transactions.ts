import {
  ACCOUNT_TYPES,
  isOnBudget,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import type { EngineActivity } from "@budget/core/budget-engine";
import type { PayeeSystem } from "@budget/schema/payees";
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
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";

export type TransactionRow = typeof transactions.$inferSelect;

export function insertStmt(db: Db, row: TransactionRow) {
  return db.insert(transactions).values(row);
}

/** Inserts the row only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: TransactionRow, guard: SQLWrapper, payeeIdSql?: SQL) {
  const r = row;
  const payeeId = payeeIdSql ?? sql`${r.payeeId}`;
  return db
    .insert(transactions)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.accountId}, ${r.date}, ${r.payeeName}, ${r.categoryId}, ${r.inflowToReadyToAssign ? 1 : 0}, ${r.memo}, ${r.amount}, ${r.cleared}, ${r.approved ? 1 : 0}, ${r.createdAt}, ${r.deletedAt}, ${r.updatedAt}, ${payeeId} where exists ${guard}`,
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
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        lt(transactions.date, before),
        not(
          and(
            inArray(accounts.type, UNCOUNTED_STARTING_TYPES),
            // null-safe: a payee-less row must not make the whole NOT(...) NULL and drop out of the WHERE
            sql`coalesce(${payees.system}, '') = 'starting_balance'`,
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

/** Cleared and uncleared sums over every open, non-deleted account of the plan. */
export async function openAccountsBalances(
  db: Db,
  budgetId: string,
): Promise<{ cleared: number; uncleared: number }> {
  const [r] = await db
    .select({
      cleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then 0 else ${transactions.amount} end), 0)`,
      uncleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        isNull(accounts.deletedAt),
        eq(accounts.closed, false),
      ),
    );
  return { cleared: r?.cleared ?? 0, uncleared: r?.uncleared ?? 0 };
}

export type TransactionDetailRow = TransactionRow & {
  categoryName: string | null;
  groupName: string | null;
  payeeSystem: PayeeSystem | null;
};

// Soft-deleted categories and groups still join, so an old row keeps its label.
const detailSelect = (db: Db) =>
  db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      payeeName: payees.name,
      payeeSystem: payees.system,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId));

const toDetail = (r: {
  t: TransactionRow;
  categoryName: string | null;
  groupName: string | null;
  payeeName: string | null;
  payeeSystem: PayeeSystem | null;
}): TransactionDetailRow => ({
  ...r.t,
  payeeName: r.payeeName ?? r.t.payeeName,
  categoryName: r.categoryName,
  groupName: r.groupName,
  payeeSystem: r.payeeSystem,
});

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

export type PlanDetailRow = TransactionDetailRow & { accountName: string };

/** Non-deleted transactions of every non-deleted account (closed included) dated `sinceDate` or later. */
export async function listDetailForPlan(
  db: Db,
  budgetId: string,
  sinceDate?: string,
): Promise<PlanDetailRow[]> {
  const conds = [eq(transactions.budgetId, budgetId), isNull(transactions.deletedAt)];
  if (sinceDate) conds.push(gte(transactions.date, sinceDate));
  const rows = await db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      accountName: accounts.name,
      payeeName: payees.name,
      payeeSystem: payees.system,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(and(...conds));
  return rows.map((r) => ({ ...toDetail(r), accountName: r.accountName }));
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
    same(t.payeeId, before.payeeId),
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

export function updateIfHoldsStmt(
  db: Db,
  before: TransactionRow,
  after: TransactionRow,
  updatedAt: string,
) {
  return db
    .update(transactions)
    .set({
      accountId: after.accountId,
      date: after.date,
      payeeName: after.payeeName,
      payeeId: after.payeeId,
      categoryId: after.categoryId,
      inflowToReadyToAssign: after.inflowToReadyToAssign,
      memo: after.memo,
      amount: after.amount,
      cleared: after.cleared,
      approved: after.approved,
      updatedAt,
    })
    .where(holdsCondition(before));
}

export function softDeleteIfHoldsStmt(db: Db, before: TransactionRow, at: string) {
  return db
    .update(transactions)
    .set({ deletedAt: at, updatedAt: at })
    .where(holdsCondition(before));
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
