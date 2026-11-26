import { and, eq, isNotNull, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { budgets } from "../db/schema/budgets";
import { transactionImages } from "../db/schema/transaction-images";
import { transactions } from "../db/schema/transactions";
import { logSelectStmt } from "./guards";
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

/** The `TransactionImage` shape of an image row as change_log JSON, with the transaction id replaced by `tx`. */
const imageJson = (tx: SQL) =>
  sql`json_object('transaction_id', ${tx}, 'content_type', content_type, 'byte_size', byte_size, 'file_name', file_name, 'created_at', created_at)`;

/**
 * UNEXECUTED, two statements (EXF-593): the live image rows `pick` selects move to the transaction `toId`: a log row
 * (`transaction_image`, `update`, entity id = the image row's id, before and after the shape with the old and the
 * new transaction id) and the update of `transaction_id`. No R2 copy: the object and its key stay. `pick` is a
 * condition on the live rows of `transaction_images` (alias `i`); both statements share it, the log first, and it
 * holds only while `guard` does. A target that already has a live image is the caller's `pick`.
 */
function moveImageStmts(
  db: Db,
  b: { budgetId: string; actor: string; now: string },
  toId: string,
  pick: SQL,
  guard: SQLWrapper,
) {
  const cond = sql`i.budget_id = ${b.budgetId} and i.deleted_at is null and (${pick}) and exists ${guard}`;
  return [
    logSelectStmt(
      db,
      {
        budgetId: b.budgetId,
        actor: b.actor,
        action: "update",
        entityType: "transaction_image",
        createdAt: b.now,
      },
      sql`select i.id as eid, i.transaction_id as from_id, i.content_type, i.byte_size, i.file_name, i.created_at
        from transaction_images i where ${cond}`,
      {
        entityId: sql`eid`,
        before: imageJson(sql`from_id`),
        after: imageJson(sql`${toId}`),
      },
    ),
    db
      .update(transactionImages)
      .set({ transactionId: toId })
      .where(sql`${transactionImages.id} in (select i.id from transaction_images i where ${cond})`),
  ];
}

/**
 * A manual match keeps `keptId` and soft-deletes `lostId`: an image only the lost row has moves to the kept row.
 * When the kept row has its own, nothing moves: the lost row keeps its image, and an unmatch brings it back.
 */
export function moveOnMatchStmts(
  db: Db,
  b: { budgetId: string; actor: string; now: string },
  keptId: string,
  lostId: string,
  guard: SQLWrapper,
) {
  return moveImageStmts(
    db,
    b,
    keptId,
    sql`i.transaction_id = ${lostId} and not exists (select 1 from transaction_images k where k.transaction_id = ${keptId} and k.deleted_at is null)`,
    guard,
  );
}

/**
 * An unmatch gives the bank's import back as the new row `newId`. The images of the match go with it: the one the
 * match moved to `entryId` (the latest `transaction_image` log row that moved an image from the old import row to
 * the entry, while that image is still live on the entry), and the one that stayed on the old import row. The old
 * import row is the latest soft-deleted bank row of the account with this import id.
 */
export function moveOnUnmatchStmts(
  db: Db,
  b: { budgetId: string; actor: string; now: string },
  row: { id: string; accountId: string; importId: string },
  newId: string,
  guard: SQLWrapper,
) {
  const old = sql`(select o.id from transactions o where o.budget_id = ${b.budgetId} and o.account_id = ${row.accountId}
    and o.import_id = ${row.importId} and o.deleted_at is not null and o.source is not null and o.parent_transaction_id is null
    order by o.deleted_at desc, o.rowid desc limit 1)`;
  const moved = sql`(select l.entity_id from change_log l where l.budget_id = ${b.budgetId} and l.entity_type = 'transaction_image'
    and l.action = 'update' and json_extract(l.after_json, '$.transaction_id') = ${row.id}
    and json_extract(l.before_json, '$.transaction_id') = ${old} order by l.rowid desc limit 1)`;
  return moveImageStmts(
    db,
    b,
    newId,
    sql`i.transaction_id = ${old} or (i.transaction_id = ${row.id} and i.id = ${moved})`,
    guard,
  );
}
