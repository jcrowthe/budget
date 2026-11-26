import { LOAN_ESCROW_SYSTEM, LOAN_INTEREST_SYSTEM } from "@budget/core/loan-engine";
import { addMonths, type Month } from "@budget/core/month";
import { transferPayeeName } from "@budget/schema/transfers";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { countsInBalance, type TransactionDetailRow } from "./transactions";

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

const pmTa = alias(accounts, "pm_ta");

/**
 * A payment's two sides as the register reads them (`TransactionDetailRow`): the addressed loan row and the row its
 * `transfer_transaction_id` names, both live, neither a split line, in this plan. No row when `txId` is not a loan
 * row. One statement; every same-named column carries its own label, as a D1 batch maps rows by column name.
 */
export function paymentSidesQuery(db: Db, budgetId: string, loanId: string, txId: string) {
  return db
    .select({
      t: transactions,
      categoryName: sql<string | null>`${categories.name}`.as("category_label"),
      groupName: sql<string | null>`${categoryGroups.name}`.as("group_label"),
      payeeName: sql<string | null>`${payees.name}`.as("payee_label"),
      payeeSystem: sql<string | null>`${payees.system}`.as("payee_system"),
      transferAccountName: sql<string | null>`${pmTa.name}`.as("transfer_account_label"),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(pmTa, eq(pmTa.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        countsInBalance(),
        sql`(${transactions.id} = ${txId} and ${transactions.accountId} = ${loanId}
          or ${transactions.id} = (select o.transfer_transaction_id from transactions o where o.id = ${txId} and o.account_id = ${loanId}))`,
      ),
    );
}

/** The detail rows of `paymentSidesQuery`, shaped as `findDetail` shapes them (a transfer's payee is the other account). */
export function toDetailRow(r: {
  t: typeof transactions.$inferSelect;
  categoryName: string | null;
  groupName: string | null;
  payeeName: string | null;
  payeeSystem: string | null;
  transferAccountName: string | null;
}): TransactionDetailRow {
  return {
    ...r.t,
    payeeName: r.transferAccountName
      ? transferPayeeName(r.transferAccountName)
      : (r.payeeName ?? r.t.payeeName),
    categoryName: r.categoryName,
    groupName: r.groupName,
    payeeSystem: r.payeeSystem as TransactionDetailRow["payeeSystem"],
    transferAccountName: r.transferAccountName,
  };
}

/** The live account (this plan) that the addressed row transfers to: the payment's other account. No row for a non-transfer. */
export function paymentOtherAccountQuery(db: Db, budgetId: string, loanId: string, txId: string) {
  return db
    .select({ account: accounts })
    .from(accounts)
    .where(
      and(
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        sql`${accounts.id} = (select o.transfer_account_id from transactions o where o.id = ${txId} and o.account_id = ${loanId})`,
      ),
    );
}
