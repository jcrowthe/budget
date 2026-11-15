import type { EngineActivity } from "@budget/core/budget-engine";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { transactions } from "../db/schema/transactions";

export type TransactionRow = typeof transactions.$inferSelect;

export function insertStmt(db: Db, row: TransactionRow) {
  return db.insert(transactions).values(row);
}

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
