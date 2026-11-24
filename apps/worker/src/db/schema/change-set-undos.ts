import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One row per undone change set (docs/undo-design.md, "Undo engine and store"). Its key stops a second undo. */
export const changeSetUndos = sqliteTable(
  "change_set_undos",
  {
    budgetId: text("budget_id").notNull(),
    changeSetId: text("change_set_id").notNull(),
    undoChangeSetId: text("undo_change_set_id").notNull(),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.changeSetId] }),
    index("change_set_undos_undo").on(t.budgetId, t.undoChangeSetId),
  ],
);
