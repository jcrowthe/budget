import { LOAN_ESCROW_SYSTEM, LOAN_INTEREST_SYSTEM } from "@budget/core/loan-engine";
import { addMonths, type Month } from "@budget/core/month";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
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
 * The loan's live frozen rows (interest or escrow) in the month of row `txId` and of the same system as it: the
 * line the row belongs to, whole rows. No row when `txId` is another kind of row. One statement, no IN list. A
 * number of rows that grows with the edits of one month, never with payments or months.
 */
export function monthFrozenRowsQuery(db: Db, budgetId: string, loanId: string, txId: string) {
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
        sql`instr(${`,${LOAN_INTEREST_SYSTEM},${LOAN_ESCROW_SYSTEM},`}, ',' || ${payees.system} || ',') > 0`,
        sql`substr(${transactions.date}, 1, 7) = (select substr(m.date, 1, 7) from transactions m where m.id = ${txId})`,
        sql`${payees.system} = (select p.system from transactions m join payees p on p.id = m.payee_id where m.id = ${txId})`,
      ),
    );
}

/** The loan's live rows of one frozen `system` in `month`, whole rows (Add Escrow's reconciled and open parts). */
export function monthSystemRowsQuery(
  db: Db,
  budgetId: string,
  loanId: string,
  system: typeof LOAN_INTEREST_SYSTEM | typeof LOAN_ESCROW_SYSTEM,
  month: Month,
) {
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
        eq(payees.system, system),
        gte(transactions.date, month),
        lt(transactions.date, addMonths(month, 1)),
      ),
    );
}
