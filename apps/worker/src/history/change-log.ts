import { type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { changeLog } from "../db/schema/change-log";
import { insertSelect } from "../repositories/insert-select";

export interface ChangeLogEntry {
  budgetId: string | null;
  actor: string;
  action: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

function row(e: ChangeLogEntry) {
  return {
    id: crypto.randomUUID(),
    budgetId: e.budgetId,
    actor: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    beforeJson: e.before == null ? null : JSON.stringify(e.before),
    afterJson: e.after == null ? null : JSON.stringify(e.after),
    createdAt: new Date().toISOString(),
  };
}

/** Returns an UNEXECUTED insert: put it in the same `db.batch` as the row change it records. */
export function changeLogInsert(db: Db, e: ChangeLogEntry) {
  return db.insert(changeLog).values(row(e));
}

/**
 * Like changeLogInsert, but writes only if `exists` (a SELECT 1 ... query on the changed table) matches.
 * Put it BEFORE the guarded UPDATE in the batch, with the same guard, so a lost race logs nothing.
 */
export function changeLogInsertIf(db: Db, e: ChangeLogEntry, exists: SQLWrapper) {
  const r = row(e);
  return insertSelect(db, changeLog, r, sql`where exists ${exists}`);
}
