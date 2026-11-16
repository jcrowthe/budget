import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    kind: text("kind", { enum: ["credit_card_payments"] }),
  },
  (t) => [
    index("category_groups_budget").on(t.budgetId),
    uniqueIndex("category_groups_payment_kind")
      .on(t.budgetId)
      .where(sql`kind IS NOT NULL AND deleted_at IS NULL`),
  ],
);
