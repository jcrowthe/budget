import { and, eq, inArray, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { importTombstones } from "../db/schema/import-tombstones";
import { transactions } from "../db/schema/transactions";
import type { TransactionRow } from "./transactions";

/** D1 allows 100 bound parameters a statement. */
export const CHUNK = 90;

export function chunked<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Import ids the plan already has: on a live row, or recorded as thrown away. */
export async function knownImportIds(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chunk of chunked(ids, CHUNK - 1)) {
    const [live, tombs] = await Promise.all([
      db
        .select({ id: transactions.importId })
        .from(transactions)
        .where(
          and(
            eq(transactions.budgetId, budgetId),
            isNull(transactions.deletedAt),
            inArray(transactions.importId, chunk),
          ),
        ),
      db
        .select({ id: importTombstones.importId })
        .from(importTombstones)
        .where(
          and(eq(importTombstones.budgetId, budgetId), inArray(importTombstones.importId, chunk)),
        ),
    ]);
    for (const r of [...live, ...tombs]) if (r.id) out.add(r.id);
  }
  return out;
}

/** The ids with a tombstone (never imported again) among `ids`. */
export async function tombstonedIds(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select({ id: importTombstones.importId })
      .from(importTombstones)
      .where(
        and(eq(importTombstones.budgetId, budgetId), inArray(importTombstones.importId, chunk)),
      );
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** A guard that holds while the plan has neither a live row nor a tombstone with this import id. */
export function notKnownSql(budgetId: string, importId: string): SQLWrapper {
  return sql`(select 1 where not exists (select 1 from transactions where budget_id = ${budgetId} and import_id = ${importId} and deleted_at is null) and not exists (select 1 from import_tombstones where budget_id = ${budgetId} and import_id = ${importId}))`;
}

export type TombstoneInput = {
  accountId: string;
  importId: string;
  budgetId: string;
  reason: "rejected" | "deleted" | "duplicate";
  transactionId: string | null;
};

/** Records the tombstone while `guard` holds; one per (account, import id), a repeat changes nothing. */
export function tombstoneIfStmt(db: Db, t: TombstoneInput, guard: SQLWrapper, at: string) {
  return db
    .insert(importTombstones)
    .select(
      sql`select ${t.accountId}, ${t.importId}, ${t.budgetId}, ${t.reason}, ${t.transactionId}, ${at} where exists ${guard}`,
    )
    .onConflictDoNothing();
}

/** Live rows of the plan with these import ids. */
export async function rowsByImportId(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  for (const chunk of chunked(ids)) {
    out.push(
      ...(await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.budgetId, budgetId),
            isNull(transactions.deletedAt),
            inArray(transactions.importId, chunk),
          ),
        )),
    );
  }
  return out;
}

export interface MatchCandidate {
  id: string;
  date: string;
  amount: number;
  createdAt: string;
  row: TransactionRow;
}

/** Hand-entered rows an import may match: live, not a split line, never imported or matched. */
export async function matchCandidates(
  db: Db,
  accountId: string,
  from: string,
  to: string,
): Promise<MatchCandidate[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
        isNull(transactions.importId),
        isNull(transactions.source),
        sql`${transactions.date} between ${from} and ${to}`,
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    amount: row.amount,
    createdAt: row.createdAt,
    row,
  }));
}

/** Date and amount of the account's live non-line rows (the recovery duplicate check). */
export async function liveDateAmounts(
  db: Db,
  accountId: string,
  from: string,
  to: string,
): Promise<{ date: string; amount: number; importId: string | null }[]> {
  return db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      importId: transactions.importId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
        sql`${transactions.date} between ${from} and ${to}`,
      ),
    );
}

/** Holds while the plan account is live, open and still linked to the bank account (and its plan is live). */
export function accountLinkedOpenSql(accountId: string, bankAccountId: string): SQLWrapper {
  return sql`(select 1 from accounts where id = ${accountId} and deleted_at is null and closed = 0 and bank_account_id = ${bankAccountId} and exists (select 1 from budgets where budgets.id = accounts.budget_id and budgets.deleted_at is null))`;
}
