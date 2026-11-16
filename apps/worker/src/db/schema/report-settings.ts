import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reportSettings = sqliteTable(
  "report_settings",
  {
    budgetId: text("budget_id").notNull(),
    report: text("report").notNull(),
    preset: text("preset"),
    startMonth: text("start_month"),
    endMonth: text("end_month"),
    excludedCategoryIds: text("excluded_category_ids").notNull().default("[]"),
    excludedAccountIds: text("excluded_account_ids").notNull().default("[]"),
    hideExportDialog: integer("hide_export_dialog", { mode: "boolean" }).notNull().default(false),
    visitedAt: text("visited_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.report] })],
);
