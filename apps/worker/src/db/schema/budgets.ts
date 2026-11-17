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
  currencyIsoCode: text("currency_iso_code").notNull().default("USD"),
  numberFormat: text("number_format").notNull().default("123,456.78"),
  symbolPlacement: text("symbol_placement", { enum: ["before", "after", "none"] })
    .notNull()
    .default("before"),
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
});
