import { FILE_FORMATS } from "@budget/schema/file-import-read";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One stored import file (its bytes are in R2 under `r2Key`). Plumbing, like plan_imports: no change_log. */
export const fileImports = sqliteTable(
  "file_imports",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    accountId: text("account_id").notNull(),
    actor: text("actor").notNull(),
    fileName: text("file_name").notNull(),
    format: text("format", { enum: FILE_FORMATS }).notNull(),
    byteSize: integer("byte_size").notNull(),
    r2Key: text("r2_key").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("file_imports_expiry").on(t.deletedAt, t.expiresAt)],
);
