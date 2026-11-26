import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userSettings = sqliteTable("user_settings", {
  actor: text("actor").primaryKey().notNull(),
  theme: text("theme").notNull().default("dark"),
  progressBars: integer("progress_bars", { mode: "boolean" }).notNull().default(true),
  balanceStyle: text("balance_style").notNull().default("default"),
  updatedAt: text("updated_at").notNull(),
});
