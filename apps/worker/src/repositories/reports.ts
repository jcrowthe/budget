import type { AccountType } from "@budget/core/account-types";

type Month = string;

import type { MonthlySum } from "@budget/schema/net-worth";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { transactions } from "../db/schema/transactions";

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
