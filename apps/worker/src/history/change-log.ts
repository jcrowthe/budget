import type { Db } from "../db/client";
import { changeLog } from "../db/schema/change-log";

export interface ChangeLogEntry {
  budgetId: string | null;
  actor: string;
  action: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

/** Returns an UNEXECUTED insert: put it in the same `db.batch` as the row change it records. */
export function changeLogInsert(db: Db, e: ChangeLogEntry) {
  return db.insert(changeLog).values({
    id: crypto.randomUUID(),
    budgetId: e.budgetId,
    actor: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    beforeJson: e.before == null ? null : JSON.stringify(e.before),
    afterJson: e.after == null ? null : JSON.stringify(e.after),
    createdAt: new Date().toISOString(),
  });
}
