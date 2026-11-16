import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    kind: text("kind", { enum: ["credit_card_payment"] }),
    accountId: text("account_id"),
  },
  (t) => [
    index("categories_group").on(t.groupId),
    index("categories_budget").on(t.budgetId),
    uniqueIndex("categories_payment_account")
      .on(t.accountId)
      .where(sql`account_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);
