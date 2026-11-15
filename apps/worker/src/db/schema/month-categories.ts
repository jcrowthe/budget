import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const monthCategories = sqliteTable(
  "month_categories",
  {
    budgetId: text("budget_id").notNull(),
    month: text("month").notNull(),
    categoryId: text("category_id").notNull(),
    assigned: integer("assigned").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.month, t.categoryId] }),
    index("month_categories_category").on(t.categoryId),
  ],
);
