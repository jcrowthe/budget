import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { changeLog } from "../db/schema/change-log";
import { insertSelect } from "./insert-select";

/** A `SELECT 1` that yields a row only while `cond` holds, for `changeLogInsertIf`. */
export function whenQuery(db: Db, cond: SQL) {
  return db.select({ x: sql`1` }).from(sql`(select 1)`).where(cond);
}

/** The ids as ONE bound parameter, for `col in (${idList(ids)})`: renders `select value from json_each(?)` bound to
 *  JSON.stringify(ids). Any number of ids (D1 allows 100 parameters per statement). */
export function idList(ids: readonly string[]): SQL {
  return sql`select value from json_each(${JSON.stringify(ids)})`;
}

/** AND of the conditions that are present. */
export function allOf(...conds: (SQL | null | undefined)[]): SQL {
  const present = conds.filter((c): c is SQL => !!c);
  return present.length === 0 ? sql`1` : sql.join(present, sql` and `);
}

/** A JSON boolean from a 0/1 column expression (so `json_object` matches `JSON.stringify`). */
export const jsonBool = (expr: SQL): SQL =>
  sql`json(case when ${expr} then 'true' else 'false' end)`;

export interface LogBase {
  budgetId: string;
  actor: string;
  action: "create" | "update" | "delete";
  entityType: string;
  createdAt: string;
}

/**
 * `INSERT INTO change_log SELECT ...` over the rows an `inner` select yields, so one statement logs every row a
 * set-update is about to change. `inner` is a full `select ... from ... where ...` whose columns the expressions
 * can name; each row gets a fresh uuid-shaped id. Put it BEFORE the update it records, with the same condition.
 */
export function logSelectStmt(
  db: Db,
  base: LogBase,
  inner: SQL,
  cols: { entityId: SQL; before: SQL | null; after: SQL | null },
) {
  const h = sql.raw("h");
  const id = sql`substr(${h}, 1, 8) || '-' || substr(${h}, 9, 4) || '-' || substr(${h}, 13, 4) || '-' || substr(${h}, 17, 4) || '-' || substr(${h}, 21, 12)`;
  return insertSelect(
    db,
    changeLog,
    {
      id,
      budgetId: base.budgetId,
      actor: base.actor,
      action: base.action,
      entityType: base.entityType,
      entityId: cols.entityId,
      beforeJson: cols.before ?? sql`null`,
      afterJson: cols.after ?? sql`null`,
      createdAt: base.createdAt,
    },
    sql`from (select lower(hex(randomblob(16))) as h, s.* from (${inner}) s)`,
  );
}
