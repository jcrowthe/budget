import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    groupId: text("group_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    note: text("note"),
  },
  (t) => [index("categories_group").on(t.groupId), index("categories_budget").on(t.budgetId)],
);
