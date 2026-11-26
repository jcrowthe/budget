import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Pending bank transactions (EXF-466): kept out of `transactions` so no balance query can see them. */
export const pendingTransactions = sqliteTable(
  "pending_transactions",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    accountId: text("account_id").notNull(),
    plaidTransactionId: text("plaid_transaction_id").notNull(),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    payeeName: text("payee_name"),
    importedPayee: text("imported_payee"),
    importPayeeName: text("import_payee_name"),
    bankDescription: text("bank_description"),
    enteredTransactionId: text("entered_transaction_id"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("pending_transactions_live")
      .on(t.budgetId, t.plaidTransactionId)
      .where(sql`deleted_at IS NULL`),
    index("pending_transactions_account").on(t.accountId, t.deletedAt),
    index("pending_transactions_plaid").on(t.budgetId, t.plaidTransactionId),
  ],
);
