import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { budgets } from "./budgets";

export const planViews = sqliteTable(
  "plan_views",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id),
    builtinKey: text("builtin_key"),
    name: text("name"),
    categoryIds: text("category_ids").notNull().default("[]"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("plan_views_builtin")
      .on(t.budgetId, t.builtinKey)
      .where(sql`builtin_key IS NOT NULL`),
    index("plan_views_budget").on(t.budgetId, t.sortOrder).where(sql`deleted_at IS NULL`),
  ],
);
