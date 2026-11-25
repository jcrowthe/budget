import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { candidateLinesQuery } from "../src/repositories/file-imports";
import { categoryNamesQuery } from "../src/repositories/imports";
import { monthRowsQuery } from "../src/repositories/loan-activity";
import { account, category, DAY, plan, send, tx } from "./bulk-helpers";
import { duplicateColumns, unguardedDb } from "./column-guard";

// EXF-1006 and its siblings: a D1 batch maps rows by column name, so a select with two columns of one name loses one.
// Each query below runs once directly (drizzle keys by field, always right) and once in a plain, unguarded batch.

const direct = getDb(env);
const batched = <T>(query: T) => getDb({ DB: unguardedDb as D1Database }).batch([query as never]);

describe("duplicate-name guard", () => {
  it("duplicateColumns lists each repeated name", () => {
    expect(duplicateColumns(["id", "name", "name", "x", "id"])).toEqual(["name", "id"]);
    expect(duplicateColumns(["id", "other_name", "payee_label"])).toEqual([]);
  });

  it("the guarded database refuses a batched or all() select with two columns named alike", async () => {
    const dup = "select a.name, p.name from accounts a join payees p on p.budget_id = a.budget_id";
    await expect(env.DB.prepare(dup).all()).rejects.toThrow(
      /Duplicate output column name\(s\) name/,
    );
    await expect(env.DB.batch([env.DB.prepare(dup)])).rejects.toThrow(/column name\(s\) name/);
    await expect(env.DB.batch([env.DB.prepare("select 1 as a, 2 as a")])).rejects.toThrow(/\) a /);
    // Labelled, or not a select: fine.
    await env.DB.batch([env.DB.prepare("select 1 as a, 2 as b")]);
  });
});

describe("batched selects keep every column", () => {
  it("categoryNamesQuery: the category name is not overwritten by its group's name", async () => {
    const bid = await plan();
    const [rows] = await batched(categoryNamesQuery(direct, bid));
    const want = await categoryNamesQuery(direct, bid);
    expect(want.length).toBeGreaterThan(0);
    expect(rows).toEqual(want);
    for (const r of rows as { name: string; groupName: string | null }[]) {
      expect(r.name).not.toBe(r.groupName);
    }
  });

  it("candidateLinesQuery: a split line keeps its category name and its group name", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const cid = await category(bid, "Groceries");
    await tx(bid, {
      account_id: aid,
      date: DAY,
      amount: -100000,
      subtransactions: [
        { amount: -60000, category_id: cid },
        { amount: -40000, category_id: cid },
      ],
    });
    const query = () => candidateLinesQuery(direct, aid, "2026-11-01", "2026-11-30");
    const want = await query();
    expect(want).toHaveLength(2);
    const [rows] = await batched(query());
    expect(rows).toEqual(want);
    expect(want[0]?.categoryName).toBeTruthy();
    expect(want[0]?.groupName).not.toBe(want[0]?.categoryName);
  });

  it("monthRowsQuery: the payee's name wins over the row's own stale payee_name", async () => {
    const bid = await plan();
    const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
      name: `ZZ Mortgage ${crypto.randomUUID().slice(0, 8)}`,
      type: "mortgage",
      balance: 200000000,
      date: DAY,
      interest_rate: "6",
      minimum_payment: 1500000,
    });
    expect(res.status).toBe(201);
    const aid = ((await res.json()) as { data: { account: { id: string } } }).data.account.id;
    await env.DB.prepare(
      "update transactions set payee_name = 'ZZ stale' where account_id = ? and payee_id is not null",
    )
      .bind(aid)
      .run();
    const query = () => monthRowsQuery(direct, bid, aid, "2026-11-01");
    const want = await query();
    expect(want.length).toBeGreaterThan(0);
    expect(want.some((r) => r.payeeName !== null && r.payeeName !== r.rowPayeeName)).toBe(true);
    const [rows] = await batched(query());
    expect(rows).toEqual(want);
  });
});
