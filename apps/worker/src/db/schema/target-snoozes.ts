import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A row = the category's target is snoozed in that month. Unsnoozing deletes the row. */
export const targetSnoozes = sqliteTable(
  "target_snoozes",
  {
    budgetId: text("budget_id").notNull(),
    categoryId: text("category_id").notNull(),
    month: text("month").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.month] }),
    index("target_snoozes_budget").on(t.budgetId),
  ],
);
