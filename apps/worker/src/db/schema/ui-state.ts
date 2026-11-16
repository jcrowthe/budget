import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const uiState = sqliteTable(
  "ui_state",
  {
    budgetId: text("budget_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.key] })],
);
