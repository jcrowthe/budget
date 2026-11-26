import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The lines of a split schedule (docs/scheduled-splits-design.md). */
export const scheduledSubtransactions = sqliteTable(
  "scheduled_subtransactions",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    scheduledTransactionId: text("scheduled_transaction_id").notNull(),
    amount: integer("amount").notNull(),
    payeeId: text("payee_id"),
    categoryId: text("category_id"),
    inflowToReadyToAssign: integer("inflow_to_ready_to_assign", { mode: "boolean" })
      .notNull()
      .default(false),
    memo: text("memo"),
    sort: integer("sort").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("scheduled_subtransactions_parent").on(t.scheduledTransactionId, t.sort),
    index("scheduled_subtransactions_category").on(t.categoryId),
    index("scheduled_subtransactions_payee").on(t.payeeId),
  ],
);
