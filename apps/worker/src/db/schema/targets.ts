import { REPEAT_UNITS, TARGET_BEHAVIORS, TARGET_CADENCES } from "@budget/core/targets";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const targets = sqliteTable(
  "targets",
  {
    categoryId: text("category_id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    cadence: text("cadence", { enum: TARGET_CADENCES }).notNull(),
    behavior: text("behavior", { enum: TARGET_BEHAVIORS }).notNull(),
    amount: integer("amount").notNull(),
    dayOfWeek: integer("day_of_week"),
    dayOfMonth: integer("day_of_month"),
    dueDate: text("due_date"),
    dueMonth: text("due_month"),
    repeatEvery: integer("repeat_every"),
    repeatUnit: text("repeat_unit", { enum: REPEAT_UNITS }),
    createdOn: text("created_on").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("targets_budget").on(t.budgetId)],
);
