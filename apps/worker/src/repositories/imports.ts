import { and, eq, inArray, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { importTombstones } from "../db/schema/import-tombstones";
import { transactions } from "../db/schema/transactions";
import { insertSelect } from "./insert-select";
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

/** Unawaited select of the ids with a tombstone among `ids` (at most CHUNK), for `db.batch`. */
export function tombstonesQuery(db: Db, budgetId: string, ids: readonly string[]) {
  return db
    .select({ id: importTombstones.importId })
    .from(importTombstones)
    .where(
      and(eq(importTombstones.budgetId, budgetId), inArray(importTombstones.importId, [...ids])),
    );
}

/** The ids with a tombstone (never imported again) among `ids`. */
export async function tombstonedIds(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chunk of chunked(ids)) {
    for (const r of await tombstonesQuery(db, budgetId, chunk)) out.add(r.id);
  }
  return out;
}

/** The ids among `budgetIds` of plans that are not deleted. One query. */
export async function livePlanIds(db: Db, budgetIds: readonly string[]): Promise<Set<string>> {
  if (budgetIds.length === 0) return new Set();
  const rows = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(inArray(budgets.id, [...budgetIds]), isNull(budgets.deletedAt)));
  return new Set(rows.map((r) => r.id));
}

export type CategoryNames = Map<
  string,
  { name: string; groupName: string | null; deleted: boolean }
>;

/** Unawaited select of every category of the plan with its group's name; `deleted` when either is deleted. */
export function categoryNamesQuery(db: Db, budgetId: string) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categoryGroups.name,
      deleted: sql<number>`(${categories.deletedAt} is not null or ${categoryGroups.deletedAt} is not null)`,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(eq(categories.budgetId, budgetId));
}

export function toCategoryNames(
  rows: { id: string; name: string; groupName: string | null; deleted: number | boolean }[],
): CategoryNames {
  return new Map(
    rows.map((r) => [r.id, { name: r.name, groupName: r.groupName, deleted: !!r.deleted }]),
  );
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
  return insertSelect(
    db,
    importTombstones,
    {
      accountId: t.accountId,
      importId: t.importId,
      budgetId: t.budgetId,
      reason: t.reason,
      transactionId: t.transactionId,
      createdAt: at,
    },
    sql`where exists ${guard}`,
  ).onConflictDoNothing();
}

/** Unawaited select of the live rows of the plan with these import ids (at most CHUNK), for `db.batch`. */
export function rowsByImportIdQuery(db: Db, budgetId: string, ids: readonly string[]) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        inArray(transactions.importId, [...ids]),
      ),
    );
}

/** Live rows of the plan with these import ids. */
export async function rowsByImportId(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  for (const chunk of chunked(ids)) out.push(...(await rowsByImportIdQuery(db, budgetId, chunk)));
  return out;
}

export interface MatchCandidate {
  id: string;
  date: string;
  amount: number;
  createdAt: string;
  row: TransactionRow;
}

export const toCandidate = (row: TransactionRow): MatchCandidate => ({
  id: row.id,
  date: row.date,
  amount: row.amount,
  createdAt: row.createdAt,
  row,
});

/** Unawaited select of the hand-entered rows an import may match: live, not a split line, never imported or matched. */
export function matchCandidatesQuery(db: Db, accountId: string, from: string, to: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
        isNull(transactions.importId),
        isNull(transactions.source),
        // never the Starting Balance: it is not a purchase the bank can repeat
        sql`coalesce((select p.system from payees p where p.id = ${transactions.payeeId}), '') <> 'starting_balance'`,
        sql`${transactions.date} between ${from} and ${to}`,
      ),
    );
}

/** Hand-entered rows an import may match: live, not a split line, never imported or matched. */
export async function matchCandidates(
  db: Db,
  accountId: string,
  from: string,
  to: string,
): Promise<MatchCandidate[]> {
  return (await matchCandidatesQuery(db, accountId, from, to)).map(toCandidate);
}

/** Unawaited select of date and amount of the account's live non-line rows (the recovery duplicate check). */
export function liveDateAmountsQuery(db: Db, accountId: string, from: string, to: string) {
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

/** Date and amount of the account's live non-line rows (the recovery duplicate check). */
export async function liveDateAmounts(
  db: Db,
  accountId: string,
  from: string,
  to: string,
): Promise<{ date: string; amount: number; importId: string | null }[]> {
  return liveDateAmountsQuery(db, accountId, from, to);
}

/** Holds while the plan account is live, open and still linked to the bank account (and its plan is live). */
export function accountLinkedOpenSql(accountId: string, bankAccountId: string): SQLWrapper {
  return sql`(select 1 from accounts where id = ${accountId} and deleted_at is null and closed = 0 and bank_account_id = ${bankAccountId} and exists (select 1 from budgets where budgets.id = accounts.budget_id and budgets.deleted_at is null))`;
}
