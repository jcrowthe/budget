import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    actor: text("actor").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status").notNull(),
    responseBody: text("response_body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actor, t.key] })],
);
