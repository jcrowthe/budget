import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { data, send } from "./account-helpers";
import { type Json, payeeWorld } from "./manage-payees-helpers";

const files = () => env.TEST_MIGRATIONS as unknown as { name: string; queries: string[] }[];
const migration = () => {
  const m = files().find((f) => f.name.includes("payee_category"));
  expect(m).toBeDefined();
  return (m?.queries ?? []).map((q) => q.trim());
};

describe("20261116101900_payee_category.sql (EXF-515)", () => {
  it("adds exactly the five columns, with their defaults and the CHECK", () => {
    const alters = migration().filter((q) => /^ALTER TABLE payees ADD COLUMN/i.test(q));
    expect(alters).toHaveLength(5);
    const text = alters.join("\n").replace(/\s+/g, " ");
    expect(text).toMatch(
      /category_mode TEXT NOT NULL DEFAULT 'history' CHECK \(category_mode IN \('history', ?'fixed', ?'off'\)\)/i,
    );
    expect(text).toMatch(/fixed_category_id TEXT(?! NOT)/i);
    expect(text).toMatch(/fixed_inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0/i);
    expect(text).toMatch(/default_category_id TEXT(?! NOT)/i);
    expect(text).toMatch(/default_inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0/i);
  });

  it("is the newest migration and is not older than 20261116101800", () => {
    const names = files()
      .map((f) => f.name)
      .sort();
    expect(names.at(-1)).toMatch(/payee_category/);
    expect(names.at(-1) ?? "").toBeGreaterThan("20261116101800");
  });

  it("backfills G,G,F and F,G (dates ascending) to G, G and a payee with no rows to null", async () => {
    const w = await payeeWorld();
    const g = (
      await data(await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ G" }))
    ).category_group as Json;
    const mk = async (name: string) =>
      (
        await data(
          await send(`/api/v1/budgets/${w.bid}/categories`, "POST", {
            group_id: g.id,
            name: `ZZ ${name}`,
          }),
        )
      ).category.id as string;
    const G = await mk("Groceries");
    const F = await mk("Fun");
    const row = (payee: string, date: string, c: string) => w.tx(payee, { date, category_id: c });
    await row("ZZ GGF", "2026-11-10", G);
    await row("ZZ GGF", "2026-11-11", G);
    await row("ZZ GGF", "2026-11-12", F);
    await row("ZZ FG", "2026-11-10", F);
    await row("ZZ FG", "2026-11-11", G);
    await w.tx("ZZ Empty"); // no category: not a counted row
    // The state at 20261116101800: the five columns hold their ADD COLUMN defaults.
    await env.DB.prepare(
      "update payees set category_mode = 'history', fixed_category_id = null, fixed_inflow_to_ready_to_assign = 0, default_category_id = null, default_inflow_to_ready_to_assign = 0 where budget_id = ?",
    )
      .bind(w.bid)
      .run();
    // The read-time fallback gives the same answer with nothing stored.
    const read = async () =>
      Object.fromEntries((await w.list()).map((p) => [p.name, p.default_category_id]));
    expect(await read()).toMatchObject({ "ZZ GGF": G, "ZZ FG": G, "ZZ Empty": null });
    for (const q of migration().filter((x) => /^UPDATE/i.test(x))) await env.DB.prepare(q).run();
    const stored = Object.fromEntries(
      (
        await env.DB.prepare(
          "select name, default_category_id d from payees where budget_id = ? and name like 'ZZ %'",
        )
          .bind(w.bid)
          .all<Json>()
      ).results.map((r) => [r.name, r.d]),
    );
    expect(stored["ZZ GGF"]).toBe(G);
    expect(stored["ZZ FG"]).toBe(G);
    expect(stored["ZZ Empty"]).toBeNull();
    expect(await read()).toMatchObject({ "ZZ GGF": G, "ZZ FG": G, "ZZ Empty": null });
  });
});
