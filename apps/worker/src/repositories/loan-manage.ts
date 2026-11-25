import { LOAN_INTEREST_SYSTEM } from "@budget/core/loan-engine";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { countsInBalance } from "./transactions";

// Loan manage: the reads behind editing or deleting a recorded line. docs/loan-manage-design.md.

/**
 * The addressed row when it is a live row of this loan (not a split line), with its payee's system and whether it
 * is a split parent. One statement, no row when it is not found.
 */
export function activityRowQuery(db: Db, budgetId: string, loanId: string, txId: string) {
  return db
    .select({
      tx: transactions,
      system: payees.system,
      isSplit:
        sql<number>`exists (select 1 from transactions c where c.parent_transaction_id = ${transactions.id} and c.deleted_at is null)`.as(
          "is_split",
        ),
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.id, txId),
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, loanId),
        countsInBalance(),
      ),
    );
}

/**
 * The loan's live interest rows in the month of row `txId`, whole rows: the line the row belongs to. A number of
 * rows that grows with the edits of one month, never with payments or months.
 */
export function monthInterestRowsQuery(db: Db, budgetId: string, loanId: string, txId: string) {
  return db
    .select({ tx: transactions })
    .from(transactions)
    .innerJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, loanId),
        countsInBalance(),
        isNull(payees.deletedAt),
        eq(payees.system, LOAN_INTEREST_SYSTEM),
        sql`substr(${transactions.date}, 1, 7) = (select substr(m.date, 1, 7) from transactions m where m.id = ${txId})`,
      ),
    );
}
