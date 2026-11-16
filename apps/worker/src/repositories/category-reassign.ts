import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactions } from "../db/schema/transactions";
import { idList, type LogBase, logSelectStmt } from "./guards";

// Moving a deleted category's transactions to another category. Kept apart from repositories/transactions.ts.

const active = (budgetId: string, fromIds: readonly string[]) =>
  sql`${transactions.budgetId} = ${budgetId} and ${transactions.categoryId} in (${idList(fromIds)}) and ${transactions.deletedAt} is null`;

export async function countActive(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const [r] = await db.all<{ n: number }>(
    sql`select count(*) as n from ${transactions} where ${active(budgetId, ids)}`,
  );
  return r?.n ?? 0;
}

/** One change_log row per active transaction that moves. */
export function logMovesStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string,
  guard: SQL,
) {
  return logSelectStmt(
    db,
    base,
    sql`select id, category_id from ${transactions} where ${active(budgetId, fromIds)} and ${guard}`,
    {
      entityId: sql`id`,
      before: sql`json_object('id', id, 'category_id', category_id)`,
      after: sql`json_object('id', id, 'category_id', ${targetId}, 'reassigned_from', category_id)`,
    },
  );
}

/** Points the active transactions of `fromIds` at the target. */
export function moveTransactionsStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string,
  now: string,
  guard: SQL,
) {
  return db
    .update(transactions)
    .set({ categoryId: targetId, updatedAt: now })
    .where(sql`${active(budgetId, fromIds)} and ${guard}`);
}
