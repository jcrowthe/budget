import { getTableColumns, getTableName, type InferInsertModel, is, SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";

export type InsertValues<T extends SQLiteTable> = { [K in keyof InferInsertModel<T>]?: unknown };

const shapes = new Map<string, SQLiteTable>();

/**
 * `insert into "<t>" ("<col>", …) select <v>, … <tail>`: columns named from the Drizzle table, in the key order
 * of `values`; an `SQL` value is inlined, any other value is bound; `undefined` throws; unnamed columns take
 * their SQL default. No statement depends on a table's column order (docs/conventions.md).
 */
export function insertSelect<T extends SQLiteTable>(
  db: Db,
  table: T,
  values: InsertValues<T>,
  tail?: SQL,
): BatchItem<"sqlite"> {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const name = getTableName(table);
  const keys = Object.keys(values);
  const v = values as Record<string, unknown>;
  for (const k of keys) {
    if (!cols[k]) throw new Error(`insertSelect: ${name}.${k} is not a column`);
    if (v[k] === undefined) throw new Error(`insertSelect: ${name}.${k} is undefined`);
  }
  const shape = keys.map((k) => cols[k]?.name).join(",");
  const id = `${name}(${shape})`;
  let sub = shapes.get(id);
  if (!sub) {
    sub = sqliteTable(
      name,
      Object.fromEntries(keys.map((k) => [k, text(cols[k]?.name as string)])),
    );
    shapes.set(id, sub);
  }
  const exprs = keys.map((k) => {
    const x = v[k];
    if (is(x, SQL)) return x;
    if (typeof (x as { getSQL?: unknown } | null)?.getSQL === "function")
      return (x as { getSQL(): SQL }).getSQL();
    return sql`${x}`;
  });
  // biome-ignore lint/suspicious/noExplicitAny: the sub-table's columns are built at run time.
  return (db as any).insert(sub).select(sql`select ${sql.join(exprs, sql`, `)} ${tail ?? sql``}`);
}
