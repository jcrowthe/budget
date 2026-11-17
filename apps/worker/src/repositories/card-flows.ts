import { CREDIT_ACCOUNT_TYPES } from "@budget/core/account-types";
import type { CardFlow } from "@budget/core/card-payment";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { countsInBalance } from "./transactions";

/**
 * The balance flows of every credit account (closed ones included) per month, for the Payment card's Balance
 * section (EXF-537): rows that count in an account's balance, dated before `before`, in ONE grouped query
 * whatever the number of cards and months. A Starting Balance row is kept apart (`starting`); the other rows
 * are split into outflows (< 0) and inflows (> 0); `paid` is the part of the inflows that is a transfer.
 */
export async function cardFlows(db: Db, budgetId: string, before: string): Promise<CardFlow[]> {
  const ym = sql<string>`substr(${transactions.date}, 1, 7)`;
  const starting = sql`coalesce(${payees.system}, '') = 'starting_balance'`;
  const rows = await db
    .select({
      accountId: transactions.accountId,
      ym,
      starting: sql<number>`coalesce(sum(case when ${starting} then ${transactions.amount} else 0 end), 0)`,
      outflows: sql<number>`coalesce(sum(case when not ${starting} and ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
      inflows: sql<number>`coalesce(sum(case when not ${starting} and ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      paid: sql<number>`coalesce(sum(case when not ${starting} and ${transactions.amount} > 0 and ${transactions.transferAccountId} is not null then ${transactions.amount} else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        isNull(accounts.deletedAt),
        sql`${accounts.type} in (${sql.join(
          CREDIT_ACCOUNT_TYPES.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      ),
    )
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(eq(transactions.budgetId, budgetId), countsInBalance(), lt(transactions.date, before)),
    )
    .groupBy(transactions.accountId, ym);
  return rows.map((r) => ({
    accountId: r.accountId,
    month: `${r.ym}-01`,
    starting: r.starting,
    outflows: r.outflows,
    inflows: r.inflows,
    paid: r.paid,
  }));
}
