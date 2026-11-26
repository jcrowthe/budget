import { CLEARED_STATUSES } from "@budget/core/account-types";
import { FLAG_COLORS } from "@budget/schema/transactions";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    accountId: text("account_id").notNull(),
    date: text("date").notNull(),
    payeeName: text("payee_name"),
    categoryId: text("category_id"),
    inflowToReadyToAssign: integer("inflow_to_ready_to_assign", { mode: "boolean" })
      .notNull()
      .default(false),
    memo: text("memo"),
    amount: integer("amount").notNull(),
    cleared: text("cleared", { enum: CLEARED_STATUSES }).notNull().default("uncleared"),
    approved: integer("approved", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
    updatedAt: text("updated_at").notNull(),
    payeeId: text("payee_id"),
    transferAccountId: text("transfer_account_id"),
    transferTransactionId: text("transfer_transaction_id"),
    parentTransactionId: text("parent_transaction_id"),
    splitIndex: integer("split_index"),
    importId: text("import_id"),
    source: text("source", { enum: ["plaid", "file"] }),
    importedPayee: text("imported_payee"),
    bankDescription: text("bank_description"),
    importDate: text("import_date"),
    importAmount: integer("import_amount"),
    importPayeeName: text("import_payee_name"),
    flagColor: text("flag_color", { enum: FLAG_COLORS }),
    matchEntryAmount: integer("match_entry_amount"),
    importMemo: text("import_memo"),
    pendingTransactionId: text("pending_transaction_id"),
    status: text("status", { enum: ["entered"] }),
  },
  (t) => [
    index("transactions_budget_date").on(t.budgetId, t.date),
    index("transactions_account").on(t.accountId),
    index("transactions_category").on(t.categoryId),
    index("transactions_payee").on(t.payeeId),
    index("transactions_transfer").on(t.transferTransactionId),
    index("transactions_parent").on(t.parentTransactionId),
    uniqueIndex("transactions_budget_import")
      .on(t.budgetId, t.importId)
      .where(sql`import_id IS NOT NULL AND deleted_at IS NULL`),
    index("transactions_pending")
      .on(t.budgetId, t.pendingTransactionId)
      .where(sql`pending_transaction_id IS NOT NULL`),
  ],
);
