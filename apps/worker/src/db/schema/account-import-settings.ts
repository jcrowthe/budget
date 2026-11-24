import { FILE_FORMATS } from "@budget/schema/file-import-read";
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The file import options remembered for an account and file format. */
export const accountImportSettings = sqliteTable(
  "account_import_settings",
  {
    accountId: text("account_id").notNull(),
    format: text("format", { enum: FILE_FORMATS }).notNull(),
    budgetId: text("budget_id").notNull(),
    optionsJson: text("options_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.format] })],
);
