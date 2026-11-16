import { ACCOUNT_TYPES } from "@budget/core/account-types";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    onBudget: integer("on_budget", { mode: "boolean" }).notNull(),
    note: text("note"),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    closed: integer("closed", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
    bankAccountId: text("bank_account_id"),
    importStartDate: text("import_start_date"),
  },
  (t) => [
    index("accounts_budget").on(t.budgetId),
    uniqueIndex("accounts_bank_account_link")
      .on(t.budgetId, t.bankAccountId)
      .where(sql`bank_account_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);
