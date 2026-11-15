import { ACCOUNT_TYPES } from "@budget/core/account-types";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  },
  (t) => [index("accounts_budget").on(t.budgetId)],
);
