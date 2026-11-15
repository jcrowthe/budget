import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const months = sqliteTable(
  "months",
  {
    budgetId: text("budget_id").notNull(),
    month: text("month").notNull(),
    note: text("note"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.month] })],
);
