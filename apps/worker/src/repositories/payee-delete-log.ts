import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { type LogBase, logSelectStmt } from "./guards";
import { idsIn } from "./payees";

// A payee delete's moved rows (EXF-882): one change_log row per transaction (split lines included) and per schedule
// that moves to the replacement, so the undo engine can return them. Put each BEFORE the move it records, with the
// move's own condition. No account_id in the rows: the undo's `where` stays on the payees surface.

/** The transactions `transactionsRepo.movePayeeStmt` is about to move, as `update` rows. */
export function logTransactionMovesStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  toId: string | null,
  guard: SQL,
) {
  const inner = sql`select id, payee_id, payee_name from transactions where budget_id = ${budgetId} and ${idsIn(sql.raw("payee_id"), fromIds)} and deleted_at is null and ${guard}`;
  return logSelectStmt(db, { ...base, action: "update", entityType: "transaction" }, inner, {
    entityId: sql`id`,
    before: sql`json_object('id', id, 'payee_id', payee_id, 'payee_name', payee_name)`,
    after: sql`json_object('id', id, 'payee_id', ${toId}, 'payee_name', ${
      toId === null ? sql`null` : sql`(select name from payees where id = ${toId})`
    })`,
  });
}

/** The schedules `scheduledRepo.movePayeeStmt` is about to move, as `update` rows (the table has no payee name). */
export function logScheduledMovesStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  toId: string | null,
  guard: SQL,
) {
  const inner = sql`select id, payee_id from scheduled_transactions where budget_id = ${budgetId} and ${idsIn(sql.raw("payee_id"), fromIds)} and deleted_at is null and ${guard}`;
  return logSelectStmt(
    db,
    { ...base, action: "update", entityType: "scheduled_transaction" },
    inner,
    {
      entityId: sql`id`,
      before: sql`json_object('id', id, 'payee_id', payee_id)`,
      after: sql`json_object('id', id, 'payee_id', ${toId})`,
    },
  );
}
