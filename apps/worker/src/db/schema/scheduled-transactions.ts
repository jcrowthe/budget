import { FREQUENCIES } from "@budget/schema/recurrence";
import { FLAG_COLORS } from "@budget/schema/transactions";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scheduledTransactions = sqliteTable(
  "scheduled_transactions",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    accountId: text("account_id").notNull(),
    dateFirst: text("date_first").notNull(),
    dateNext: text("date_next").notNull(),
    frequency: text("frequency", { enum: FREQUENCIES }).notNull(),
    amount: integer("amount").notNull(),
    payeeId: text("payee_id"),
    categoryId: text("category_id"),
    inflowToReadyToAssign: integer("inflow_to_ready_to_assign", { mode: "boolean" })
      .notNull()
      .default(false),
    memo: text("memo"),
    flagColor: text("flag_color", { enum: FLAG_COLORS }),
    writeToken: text("write_token").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("scheduled_transactions_budget_next").on(t.budgetId, t.dateNext),
    index("scheduled_transactions_due").on(t.dateNext).where(sql`deleted_at IS NULL`),
    index("scheduled_transactions_account").on(t.accountId),
  ],
);
