import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const changeLog = sqliteTable(
  "change_log",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id"),
    actor: text("actor").notNull(),
    action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("change_log_budget_created").on(t.budgetId, t.createdAt)],
);
