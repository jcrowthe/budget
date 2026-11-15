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

export function insertStmt(db: Db, row: AccountRow) {
  return db.insert(accounts).values(row);
}
