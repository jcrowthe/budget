import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import * as accountsRepo from "../src/repositories/accounts";
import { seedConnections } from "./connection-list-helpers";

const sources = import.meta.glob<string>(["../src/repositories/*.ts", "../src/services/*.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
});
const design = import.meta.glob<string>("../../../docs/connection-list-design.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** Every IN-list site: the patterns of the design table's grep (`inArray(`, `notInArray(`, `idList(`, hand-written `in (${`). */
const SITE = /inArray\(|notInArray\(|idList\(|\bin \(\$\{/g;

/** Sites per file on the design's base plus its fixes. A new site fails here: audit it, add it to the design table, then update the count. */
const AUDITED: Record<string, number> = {
  "repositories/accounts.ts": 6,
  "repositories/bank-connections.ts": 2,
  "repositories/card-flows.ts": 1,
  "repositories/categories.ts": 12,
  "repositories/category-reassign.ts": 2,
  "repositories/imports.ts": 4,
  "repositories/month-categories.ts": 2,
  "repositories/plan-activity.ts": 2,
  "repositories/reports.ts": 1,
  "repositories/scheduled-transactions.ts": 1,
  "repositories/transactions.ts": 1,
  "services/category-delete.ts": 4,
};
// guards.ts defines idList; it is the helper, not a site.
const HELPER = "repositories/guards.ts";

describe("EXF-881: the design's IN-list table covers every site (gap 4)", () => {
  const table = Object.values(design)[0] ?? "";

  it("finds the same sites as the audited list, file by file", () => {
    const found: Record<string, number> = {};
    for (const [path, text] of Object.entries(sources)) {
      const key = path.replace("../src/", "");
      const n = (text.match(SITE) ?? []).length;
      if (n > 0 && key !== HELPER) found[key] = n;
    }
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(found).toEqual(AUDITED);
  });

  it("names every audited file in the design table, which is marked complete", () => {
    expect(table).toContain("The table is **complete**");
    for (const key of Object.keys(AUDITED)) {
      const base = key.split("/")[1] as string;
      expect(table, `the design table does not name ${key}`).toContain(base);
    }
  });

  it("leaves no unbounded environment-wide list in the fixed readers", () => {
    const acc = Object.entries(sources).find(([p]) => p.endsWith("repositories/accounts.ts"))?.[1];
    expect(acc).toContain("export async function linksInEnvironment");
    const conn = Object.entries(sources).find(([p]) =>
      p.endsWith("repositories/bank-connections.ts"),
    )?.[1];
    expect(conn).not.toMatch(/inArray\(bankAccounts\.bankConnectionId/);
  });
});

describe("EXF-881: the failure the pre-fix tests showed still reproduces (gap 5)", () => {
  // Before the fix the list answered 500 with `D1_ERROR: too many SQL variables`
  // (design, "The cause, read from the server"): 100 ids + the plan id = 101 parameters.
  // This pins that cause on the unfixed query shape, so the regression tests stay sensitive to it.
  it("a statement of 101 bound parameters is refused by D1 with 'too many SQL variables'", async () => {
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    const sql = `select count(*) n from accounts where bank_account_id in (${ids.map(() => "?").join(",")})`;
    await expect(
      env.DB.prepare(sql)
        .bind(...ids)
        .first(),
    ).rejects.toThrow(/too many SQL variables/);
  });

  it("linksForPlan with 100 ids (101 parameters) fails with that error; a sub-select read does not", async () => {
    const s = await seedConnections("sandbox", 1, 100);
    const conn = s.connections[0];
    if (!conn) throw new Error("no seed");
    const db = getDb(env);
    const err = await accountsRepo.linksForPlan(db, s.plan, conn.bankAccountIds).then(
      () => null,
      (e: unknown) => e,
    );
    const text = `${String(err)} ${String((err as { cause?: unknown } | null)?.cause)}`;
    expect(text).toMatch(/too many SQL variables/);
    const map = await accountsRepo.linksInEnvironment(db, s.plan, "sandbox");
    expect(map.size).toBe(0);
  });
});
