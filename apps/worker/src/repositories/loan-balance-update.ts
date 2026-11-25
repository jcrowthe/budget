import { LOAN_ESCROW_SYSTEM, LOAN_INTEREST_SYSTEM } from "@budget/core/loan-engine";
import type { Month } from "@budget/core/month";
import { and, eq, isNull, lt, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { accountHolds, accountSumIs } from "./accounts";
import { logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";
import { reconciledAtIs } from "./reconcile";
import { countsInBalance } from "./transactions";

// EXF-543: the statements of a loan's Update Balance. docs/loan-update-balance-design.md.

/** The system payees the update reads or creates, as one bound parameter: no list in the SQL. */
const KINDS = `,${LOAN_INTEREST_SYSTEM},${LOAN_ESCROW_SYSTEM},reconciliation_adjustment,`;

/** The three system payees of the plan, live ones only. One statement. */
export function systemPayeesQuery(db: Db, budgetId: string) {
  return db
    .select()
    .from(payees)
    .where(
      and(
        eq(payees.budgetId, budgetId),
        isNull(payees.deletedAt),
        sql`instr(${KINDS}, ',' || ${payees.system} || ',') > 0`,
      ),
    );
}

/**
 * The loan's live interest and escrow rows that are not reconciled (the edited ones) dated before `before`, whole
 * rows (the update replaces them). A number of rows that grows with the edits, never with the payments.
 */
export function editedRowsQuery(db: Db, budgetId: string, loanId: string, before: Month) {
  return db
    .select({ tx: transactions, system: payees.system })
    .from(transactions)
    .innerJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, loanId),
        countsInBalance(),
        sql`${transactions.cleared} <> 'reconciled'`,
        lt(transactions.date, before),
        sql`instr(${`,${LOAN_INTEREST_SYSTEM},${LOAN_ESCROW_SYSTEM},`}, ',' || ${payees.system} || ',') > 0`,
      ),
    );
}

/** One frozen row to write: the row's own fields and its `transactionToApi` image for the log. */
export type FrozenJson = {
  id: string;
  system: string;
  name: string;
  date: string;
  amount: number;
  img: unknown;
};

const jv = (path: string): SQL => sql.raw(`json_extract(j.value, '$.${path}')`);

/** The marker guard of the batch after its first statement: `last_reconciled_at` is this request's `now`. */
export const markedBy = (db: Db, accountId: string, now: string) =>
  reconciledAtIs(db, accountId, now);

/**
 * The first statement: the account's update, while the account is as read, its stored sum is `stored` and its
 * terms are unchanged. Every later statement is guarded by the marker it sets.
 */
export function markUpdatedStmt(
  db: Db,
  before: typeof accounts.$inferSelect,
  p: { now: string; stored: number; rate: string | null; escrow: number },
) {
  const guard = and(
    accountSumIs(before.id, p.stored),
    sql`${accounts.interestRate} is ${before.interestRate}`,
    sql`${accounts.escrowAmount} is ${before.escrowAmount}`,
  ) as SQL;
  return db
    .update(accounts)
    .set({ lastReconciledAt: p.now, interestRate: p.rate, escrowAmount: p.escrow })
    .where(and(eq(accounts.id, before.id), sql`exists ${accountHolds(db, before, guard)}`));
}

/** Inserts every frozen row of the JSON in one statement, while the marker holds. */
export function frozenInsertStmt(
  db: Db,
  p: { budgetId: string; accountId: string; json: string; now: string; marker: SQLWrapper },
) {
  return insertSelect(
    db,
    transactions,
    {
      id: jv("id"),
      budgetId: p.budgetId,
      accountId: p.accountId,
      date: jv("date"),
      payeeName: jv("name"),
      categoryId: sql`null`,
      inflowToReadyToAssign: 0,
      memo: sql`null`,
      amount: jv("amount"),
      cleared: "reconciled",
      approved: 1,
      createdAt: p.now,
      deletedAt: sql`null`,
      updatedAt: p.now,
      payeeId: sql`(select p.id from payees p where p.budget_id = ${p.budgetId} and p.system = ${jv("system")} and p.deleted_at is null)`,
    },
    sql`from json_each(${p.json}) j where exists ${p.marker}`,
  );
}

/** The `create` log rows of the frozen rows, one statement for all of them. */
export function frozenLogStmt(
  db: Db,
  p: { budgetId: string; actor: string; json: string; now: string; marker: SQLWrapper },
) {
  return logSelectStmt(
    db,
    {
      budgetId: p.budgetId,
      actor: p.actor,
      action: "create",
      entityType: "transaction",
      createdAt: p.now,
    },
    sql`select j.value as jv, json_extract(j.value, '$.id') as eid from json_each(${p.json}) j where exists ${p.marker}`,
    { entityId: sql`eid`, before: null, after: sql`json_extract(jv, '$.img')` },
  );
}

/** The `delete` log rows of the replaced edited rows (`[{ id, img }]`), one statement. */
export function editedLogStmt(
  db: Db,
  p: { budgetId: string; actor: string; json: string; now: string; marker: SQLWrapper },
) {
  return logSelectStmt(
    db,
    {
      budgetId: p.budgetId,
      actor: p.actor,
      action: "delete",
      entityType: "transaction",
      createdAt: p.now,
    },
    sql`select j.value as jv, json_extract(j.value, '$.id') as eid from json_each(${p.json}) j where exists ${p.marker}`,
    { entityId: sql`eid`, before: sql`json_extract(jv, '$.img')`, after: null },
  );
}

/** Soft-deletes the edited rows (`[{ id, img }]`) while the marker holds. */
export function editedDeleteStmt(db: Db, p: { json: string; now: string; marker: SQLWrapper }) {
  return db
    .update(transactions)
    .set({ deletedAt: p.now, updatedAt: p.now })
    .where(
      and(
        isNull(transactions.deletedAt),
        sql`${transactions.id} in (select json_extract(j.value, '$.id') from json_each(${p.json}) j)`,
        sql`exists ${p.marker}`,
      ),
    );
}
