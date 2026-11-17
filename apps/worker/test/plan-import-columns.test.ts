import { env } from "cloudflare:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts } from "../src/db/schema/accounts";
import { categories } from "../src/db/schema/categories";
import { categoryGroups } from "../src/db/schema/category-groups";
import { monthCategories } from "../src/db/schema/month-categories";
import { payees } from "../src/db/schema/payees";
import { scheduledTransactions } from "../src/db/schema/scheduled-transactions";
import { transactions } from "../src/db/schema/transactions";
import { type ImportTable, importColumnNames } from "../src/repositories/plan-import";

// EXF-725: the import names the columns it writes. Each name exists, and a column that must have a value is named.
const TABLES = [
  ["accounts", accounts],
  ["category_groups", categoryGroups],
  ["categories", categories],
  ["payees", payees],
  ["month_categories", monthCategories],
  ["transactions", transactions],
  ["scheduled_transactions", scheduledTransactions],
] as const;

describe.each(TABLES)("the import's columns of %s", (t, table) => {
  const named = importColumnNames(t as ImportTable);
  it("are all columns of the Drizzle table", () => {
    expect(getTableName(table)).toBe(t);
    const all = Object.values(getTableColumns(table)).map((c) => c.name);
    const unknown = named.filter((n) => !all.includes(n));
    expect(unknown, `${t}: ${unknown.join(", ")}`).toEqual([]);
  });
  it("name every column that is not null and has no default (Drizzle)", () => {
    const missing = Object.values(getTableColumns(table))
      .filter((c) => c.notNull && !c.hasDefault)
      .map((c) => c.name)
      .filter((n) => !named.includes(n));
    expect(missing, `${t}: ${missing.join(", ")}`).toEqual([]);
  });
  it("name every column that is not null and has no default (the database)", async () => {
    const { results } = await env.DB.prepare(`pragma table_info(${t})`).all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>();
    const missing = results
      .filter((c) => c.notnull === 1 && c.dflt_value === null)
      .map((c) => c.name)
      .filter((n) => !named.includes(n));
    expect(missing, `${t}: ${missing.join(", ")}`).toEqual([]);
  });
});
