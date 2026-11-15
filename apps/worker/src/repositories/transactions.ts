import {
  ACCOUNT_TYPES,
  isOnBudget,
  STARTING_BALANCE_PAYEE,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import type { EngineActivity } from "@budget/core/budget-engine";
import { and, eq, inArray, isNull, lt, not, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
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
            eq(transactions.payeeName, STARTING_BALANCE_PAYEE),
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
