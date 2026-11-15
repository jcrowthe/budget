import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const secrets = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
  iv: blob("iv", { mode: "buffer" }).notNull(),
  keyVersion: integer("key_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
