import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { bankConnections } from "./bank-connections";

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    bankConnectionId: text("bank_connection_id")
      .notNull()
      .references(() => bankConnections.id),
    plaidAccountId: text("plaid_account_id").notNull(),
    name: text("name").notNull(),
    mask: text("mask"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    currentBalance: integer("current_balance"),
    availableBalance: integer("available_balance"),
    balanceUpdatedAt: text("balance_updated_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [unique().on(t.bankConnectionId, t.plaidAccountId)],
);
