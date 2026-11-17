import { env } from "cloudflare:test";
import { sql, Table } from "drizzle-orm";
import { text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { accounts } from "../src/db/schema/accounts";
import { insertSelect } from "../src/repositories/insert-select";
import { type Json, plan, q, send } from "./bulk-helpers";
import { importForm, postImport, sampleZip } from "./plan-import-helpers";
import { reconcile } from "./reconcile-helpers";

// EXF-725: no statement depends on a table's column order.
describe("insertSelect", () => {
  it("names the columns, binds the values and keeps the tail", () => {
    const q = insertSelect(
      getDb(env),
      accounts,
      { id: "x", budgetId: "b", starred: 0 },
      sql`where exists (select 1)`,
    ) as unknown as { toSQL(): { sql: string; params: unknown[] } };
    expect(q.toSQL()).toEqual({
      sql: 'insert into "accounts" ("id", "budget_id", "starred") select ?, ?, ? where exists (select 1)',
      params: ["x", "b", 0],
    });
  });
  it("refuses an undefined value and an unknown column", () => {
    expect(() => insertSelect(getDb(env), accounts, { id: undefined })).toThrow(/undefined/);
    expect(() => insertSelect(getDb(env), accounts, { nope: 1 } as never)).toThrow(/not a column/);
  });
});

// A table that gains a column must not break the statements that write it (reconcile's `last_reconciled_at` did).
async function createsAndImports() {
  const bid = await plan();
  for (const type of ["checking", "creditCard"]) {
    const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
      name: `ZZ ${type}`,
      type,
      balance: 1000,
      date: "2026-11-10",
    });
    expect(res.status, await res.clone().text()).toBe(201);
  }
  const zip = await sampleZip();
  const imp = await postImport(
    importForm([{ name: "Sample Plan as of 2026-11-15 19-51.zip", data: zip }]),
  );
  expect(imp.status, await imp.clone().text()).toBe(201);
  const nb = ((await imp.json()) as Json).data.budget_id as string;
  expect(
    (
      (await q(
        "select count(*) n from accounts where budget_id = ? and zz_probe is not null",
        nb,
      )) as Json[]
    )[0]?.n,
  ).toBe(0);
  return bid;
}

describe("a new nullable column on accounts", () => {
  beforeAll(async () => {
    await env.DB.prepare("ALTER TABLE accounts ADD COLUMN zz_probe TEXT").run();
  });
  afterAll(async () => {
    await env.DB.prepare("ALTER TABLE accounts DROP COLUMN zz_probe").run();
  });

  it("is harmless while only the database has it", async () => {
    await createsAndImports();
  });

  describe("and Drizzle knows it", () => {
    beforeAll(() => {
      const probe = text("zz_probe").build(accounts as never);
      // biome-ignore lint/suspicious/noExplicitAny: the probe column is attached to the module's table object.
      const t = accounts as any;
      t[Table.Symbol.Columns].zzProbe = probe;
      t.zzProbe = probe;
    });
    afterAll(() => {
      // biome-ignore lint/suspicious/noExplicitAny: undoes the probe.
      const t = accounts as any;
      delete t[Table.Symbol.Columns].zzProbe;
      delete t.zzProbe;
    });

    it("lets accounts be created and a plan be imported, and a reconcile with an adjustment", async () => {
      const bid = await createsAndImports();
      const list = (await (await send(`/api/v1/budgets/${bid}/accounts`, "GET")).json()) as Json;
      const a = list.data.accounts[0];
      const rec = await reconcile(bid, a.id, {
        statement_balance: a.cleared_balance - 700,
        create_adjustment: true,
        today: "2026-11-16",
      });
      expect(rec.status, await rec.clone().text()).toBe(200);
    });
  });
});
