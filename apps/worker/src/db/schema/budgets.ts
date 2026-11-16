import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  lastOpenedAt: text("last_opened_at"),
  bankEnvironment: text("bank_environment", { enum: ["production", "sandbox"] })
    .notNull()
    .default("production"),
});
