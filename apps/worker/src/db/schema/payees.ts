import { PAYEE_CATEGORY_MODES } from "@budget/schema/payee-category";
import { PAYEE_SYSTEMS } from "@budget/schema/payees";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const payees = sqliteTable(
  "payees",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    name: text("name").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    system: text("system", { enum: PAYEE_SYSTEMS }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    categoryMode: text("category_mode", { enum: PAYEE_CATEGORY_MODES })
      .notNull()
      .default("history"),
    fixedCategoryId: text("fixed_category_id"),
    fixedInflowToReadyToAssign: integer("fixed_inflow_to_ready_to_assign", { mode: "boolean" })
      .notNull()
      .default(false),
    defaultCategoryId: text("default_category_id"),
    defaultInflowToReadyToAssign: integer("default_inflow_to_ready_to_assign", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    uniqueIndex("payees_budget_name")
      .on(t.budgetId, t.name)
      .where(sql`deleted_at IS NULL AND system IS NULL`),
    uniqueIndex("payees_budget_system")
      .on(t.budgetId, t.system)
      .where(sql`deleted_at IS NULL AND system IS NOT NULL`),
  ],
);
