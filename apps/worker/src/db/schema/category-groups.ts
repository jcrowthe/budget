import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const categoryGroups = sqliteTable(
  "category_groups",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("category_groups_budget").on(t.budgetId)],
);
