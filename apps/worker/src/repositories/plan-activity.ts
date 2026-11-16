import {
  ACCOUNT_TYPES,
  CREDIT_ACCOUNT_TYPES,
  isOnBudget,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import type { EngineActivity } from "@budget/core/budget-engine";
import { and, eq, inArray, isNull, lt, not, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";

const ta = alias(accounts, "ta");

// A card's Starting Balance has no category and feeds nothing (EXF-532 rule 3).
const UNCOUNTED_STARTING_TYPES = ACCOUNT_TYPES.filter(
  (t) => isOnBudget(t) && !startingBalanceFeedsReadyToAssign(t),
);

/**
 * The engine's activity rows (EXF-532, EXF-535): active transactions on active accounts dated before
 * `before`, summed per month in SQL. Beyond the cash read it keeps the account of a credit-account row
 * (credit spending is split per card) and the credit side of a transfer between two on-plan accounts
 * (a payment, or an advance); the cash side of such a transfer counts nowhere.
 */
export async function planActivity(
  db: Db,
  budgetId: string,
  before: string,
): Promise<EngineActivity[]> {
  const ym = sql<string>`substr(${transactions.date}, 1, 7)`;
  const xfer = sql`(${transactions.transferAccountId} is not null and ${accounts.onBudget} = 1 and coalesce(${ta.onBudget}, 0) = 1)`;
  const isCard = sql`${accounts.type} in (${sql.join(
    CREDIT_ACCOUNT_TYPES.map((t) => sql`${t}`),
    sql`, `,
  )})`;
  const categoryId = sql<
    string | null
  >`case when ${xfer} then null else ${transactions.categoryId} end`;
  const accountId = sql<string | null>`case when ${isCard} then ${accounts.id} end`;
  const transfer = sql<number>`case when ${xfer} then 1 else 0 end`;
  const rows = await db
    .select({
      ym,
      amount: sql<number>`sum(${transactions.amount})`,
      categoryId,
      inflow: transactions.inflowToReadyToAssign,
      onBudget: accounts.onBudget,
      accountType: accounts.type,
      accountId,
      transfer,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(ta, eq(ta.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        lt(transactions.date, before),
        // The cash side of a transfer between two on-plan accounts counts nowhere; the credit side is a payment.
        sql`not (${xfer} and not ${isCard})`,
        // A split parent counts nothing: its lines (rows of their own) count in their categories.
        sql`not exists (select 1 from transactions l where l.parent_transaction_id = ${transactions.id} and l.deleted_at is null)`,
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
      categoryId,
      transactions.inflowToReadyToAssign,
      accounts.onBudget,
      accounts.type,
      accountId,
      transfer,
    );
  return rows.map((r) => ({
    date: `${r.ym}-01`,
    amount: r.amount,
    categoryId: r.categoryId,
    inflowToReadyToAssign: r.inflow,
    onBudget: r.onBudget,
    accountType: r.accountType,
    accountId: r.accountId,
    transfer: r.transfer === 1,
  }));
}
