import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";

// EXF-477 case 14: the migration only adds; a plan that exists before it is listed and read as before.
describe("plan_imports migration", () => {
  const migration = () => {
    const files = env.TEST_MIGRATIONS as unknown as { name: string; queries: string[] }[];
    const m = files.find((f) => f.name.includes("plan_imports"));
    expect(m, "the migration is in TEST_MIGRATIONS").toBeDefined();
    expect(m?.name).toContain("20261116101300");
    return (m?.queries ?? []).map((s) => s.trim()).filter((s) => s !== "");
  };

  it("holds CREATE TABLE and CREATE INDEX statements only", () => {
    const statements = migration();
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s, s).toMatch(/^(--[^\n]*\n)*\s*CREATE (TABLE|INDEX) /);
    expect(statements.filter((s) => /CREATE TABLE/.test(s))).toHaveLength(1);
  });

  it("leaves the plan table's columns as they were", async () => {
    const cols = (await q("select name from pragma_table_info('budgets')"))
      .map((r) => r.name)
      .sort();
    expect(cols).toEqual([
      "bank_environment",
      "created_at",
      "currency_iso_code",
      "date_format",
      "deleted_at",
      "expected_income",
      "flag_names",
      "id",
      "last_opened_at",
      "name",
      "number_format",
      "symbol_placement",
      "updated_at",
    ]);
  });

  it("a plan made with the pre-migration columns is listed and read as before", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "insert into budgets (id, name, created_at, updated_at, deleted_at, last_opened_at, bank_environment) values (?, 'ZZ-TEST old plan', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', null, null, 'production')",
    )
      .bind(id)
      .run();
    const list = ((await (await json("/api/v1/budgets")).json()) as Json).data.budgets as Json[];
    expect(list.find((b) => b.id === id)).toMatchObject({
      name: "ZZ-TEST old plan",
      created_at: "2026-10-01T00:00:00.000Z",
    });
    const one = await json(`/api/v1/budgets/${id}`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as Json).data.budget.name).toBe("ZZ-TEST old plan");
    expect((await json(`/api/v1/budgets/${id}/months/2026-10-01`)).status).toBe(200);
    expect((await json(`/api/v1/budgets/${id}/accounts`)).status).toBe(200);
    expect((await q("select count(*) n from plan_imports where budget_id = ?", id))[0]?.n).toBe(0);
  });
});
