import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";

export type AccountRow = typeof accounts.$inferSelect;

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)))
    .limit(1);
  return row;
}

/** The highest sort_order among the plan's active accounts, or -1 when there is none. */
export async function maxSort(db: Db, budgetId: string): Promise<number> {
  const [r] = await db
    .select({ m: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(and(eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)));
  return r?.m ?? -1;
}

/** A `SELECT 1` that holds while `sort` is still the next free sort_order, for the guarded insert. */
export function sortIsNext(db: Db, budgetId: string, sort: number) {
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${accounts.sortOrder}), -1) + 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null) = ${sort}`,
    );
}

/** Inserts the row only while its sort_order is still the next free one (so concurrent creates never share one). */
export function insertIfSortStmt(db: Db, row: AccountRow) {
  const r = row;
  return db
    .insert(accounts)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.type}, ${r.onBudget ? 1 : 0}, ${r.note}, ${r.starred ? 1 : 0}, ${r.closed ? 1 : 0}, ${r.sortOrder}, ${r.createdAt}, ${r.deletedAt} where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
    );
}
