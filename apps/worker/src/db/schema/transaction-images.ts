import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const transactionImages = sqliteTable(
  "transaction_images",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    /** The R2 object key. Never returned by the API or written to change_log. */
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    fileName: text("file_name"),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
    objectDeletedAt: text("object_deleted_at"),
  },
  (t) => [
    uniqueIndex("transaction_images_live").on(t.transactionId).where(sql`${t.deletedAt} is null`),
    index("transaction_images_sweep")
      .on(t.budgetId)
      .where(sql`${t.deletedAt} is not null and ${t.objectDeletedAt} is null`),
  ],
);
