import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bankConnections = sqliteTable(
  "bank_connections",
  {
    id: text("id").primaryKey(),
    displayId: text("display_id").notNull().unique(),
    environment: text("environment", { enum: ["production", "sandbox"] }).notNull(),
    plaidItemId: text("plaid_item_id").notNull().unique(),
    institutionId: text("institution_id").notNull(),
    institutionName: text("institution_name").notNull(),
    institutionLogo: text("institution_logo"),
    nickname: text("nickname").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    lastSyncedAt: text("last_synced_at"),
    syncCursor: text("sync_cursor"),
    lastResetAt: text("last_reset_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("bank_connections_environment").on(t.environment, t.createdAt)],
);
