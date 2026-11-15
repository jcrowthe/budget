import { env } from "cloudflare:test";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<Record<string, unknown>>("../src/db/schema/*.ts", { eager: true });

describe("schema drift", () => {
  it("every Drizzle table matches the migrated database", async () => {
    const tables = Object.values(modules).flatMap(
      (m) => Object.values(m).filter((v) => is(v, SQLiteTable)) as SQLiteTable[],
    );
    expect(tables.length).toBeGreaterThanOrEqual(4);
    for (const t of tables) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${getTableName(t)})`).all<{
        name: string;
      }>();
      expect(results.map((r) => r.name).sort(), getTableName(t)).toEqual(
        Object.values(getTableColumns(t))
          .map((c) => c.name)
          .sort(),
      );
    }
  });
});
