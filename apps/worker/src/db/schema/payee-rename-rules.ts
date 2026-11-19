import { RENAME_RULE_KINDS } from "@budget/schema/rename-rules";
import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const payeeRenameRules = sqliteTable(
  "payee_rename_rules",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    payeeId: text("payee_id").notNull(),
    kind: text("kind", { enum: RENAME_RULE_KINDS }).notNull(),
    text: text("text").notNull(),
    matchText: text("match_text").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("payee_rename_rules_payee")
      .on(t.payeeId, t.kind, t.matchText)
      .where(sql`deleted_at IS NULL`),
    index("payee_rename_rules_budget")
      .on(t.budgetId, t.kind, t.matchText)
      .where(sql`deleted_at IS NULL`),
  ],
);
