import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { budgets } from "../db/schema/budgets";
import { transactionImages } from "../db/schema/transaction-images";
import { transactions } from "../db/schema/transactions";
import { insertSelect } from "./insert-select";

export type ImageRow = typeof transactionImages.$inferSelect;

/** How many soft-deleted rows whose object may still exist one write retries. */
export const SWEEP_LIMIT = 20;

/** SQL of a guard: the plan is live and the transaction is a live, non-split-line row of it. */
export const liveTransactionGuard = (budgetId: string, transactionId: string) =>
  sql`(select 1 from ${transactions} where ${transactions.id} = ${transactionId} and ${transactions.budgetId} = ${budgetId} and ${transactions.deletedAt} is null and ${transactions.parentTransactionId} is null and exists (select 1 from ${budgets} where ${budgets.id} = ${budgetId} and ${budgets.deletedAt} is null))`;

/** The statements of the read batch of a write, UNEXECUTED, in this order: plan, transaction, live image, sweepable rows. */
export function readForWrite(db: Db, budgetId: string, transactionId: string) {
  return [
    db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), isNull(budgets.deletedAt)))
      .limit(1),
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.budgetId, budgetId),
          isNull(transactions.deletedAt),
          isNull(transactions.parentTransactionId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(transactionImages)
      .where(
        and(
          eq(transactionImages.transactionId, transactionId),
          isNull(transactionImages.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: transactionImages.id, r2Key: transactionImages.r2Key })
      .from(transactionImages)
      .where(
        and(
          eq(transactionImages.budgetId, budgetId),
          isNotNull(transactionImages.deletedAt),
          isNull(transactionImages.objectDeletedAt),
        ),
      )
      .limit(SWEEP_LIMIT),
  ] as const;
}

/** The live image of a live transaction of a live plan: one select joining all three. */
export async function findLive(
  db: Db,
  budgetId: string,
  transactionId: string,
): Promise<ImageRow | undefined> {
  const [row] = await db
    .select({ image: transactionImages })
    .from(transactionImages)
    .innerJoin(
      transactions,
      and(
        eq(transactions.id, transactionImages.transactionId),
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
      ),
    )
    .innerJoin(budgets, and(eq(budgets.id, budgetId), isNull(budgets.deletedAt)))
    .where(
      and(
        eq(transactionImages.transactionId, transactionId),
        eq(transactionImages.budgetId, budgetId),
        isNull(transactionImages.deletedAt),
      ),
    )
    .limit(1);
  return row?.image;
}

/** UNEXECUTED: inserts the live row while the guard holds. */
export function insertIfStmt(
  db: Db,
  row: Omit<ImageRow, "deletedAt" | "objectDeletedAt">,
  guard: ReturnType<typeof liveTransactionGuard>,
) {
  return insertSelect(
    db,
    transactionImages,
    {
      id: row.id,
      budgetId: row.budgetId,
      transactionId: row.transactionId,
      r2Key: row.r2Key,
      contentType: row.contentType,
      byteSize: row.byteSize,
      fileName: row.fileName,
      createdAt: row.createdAt,
    },
    sql`where exists ${guard}`,
  );
}

/** UNEXECUTED: soft-deletes the live row `id` while the guard holds. */
export function softDeleteIfStmt(
  db: Db,
  id: string,
  now: string,
  guard: ReturnType<typeof liveTransactionGuard>,
) {
  return db
    .update(transactionImages)
    .set({ deletedAt: now })
    .where(
      and(eq(transactionImages.id, id), isNull(transactionImages.deletedAt), sql`exists ${guard}`),
    );
}

/** SQL of a guard that holds while the live row `id` still exists. */
export const liveImageGuard = (id: string) =>
  sql`(select 1 from ${transactionImages} where ${transactionImages.id} = ${id} and ${transactionImages.deletedAt} is null)`;

/** UNEXECUTED: marks rows whose object is gone (the ids go in as one JSON parameter). */
export function markObjectsDeletedStmt(db: Db, idsJson: string, now: string) {
  return db
    .update(transactionImages)
    .set({ objectDeletedAt: now })
    .where(sql`${transactionImages.id} in (select value from json_each(${idsJson}))`);
}
