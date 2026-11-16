import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** An import the user threw away (or a bank copy skipped as a duplicate): never imported again. */
export const importTombstones = sqliteTable(
  "import_tombstones",
  {
    accountId: text("account_id").notNull(),
    importId: text("import_id").notNull(),
    budgetId: text("budget_id").notNull(),
    reason: text("reason", { enum: ["rejected", "deleted", "duplicate"] }).notNull(),
    transactionId: text("transaction_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.importId] }),
    index("import_tombstones_budget").on(t.budgetId, t.importId),
  ],
);
