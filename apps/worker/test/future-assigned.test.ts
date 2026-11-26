import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { setAssigned } from "../src/services/months";
import { actor, api, cat, type Json, mcp, month, plan, send } from "./category-helpers";
import { apiDocument } from "./surface";

const TODAY = "2026-11-15";
const NOV = "2026-11-01";

async function seed() {
  const bid = await plan();
  const m = await month(bid, NOV);
  const groceries = cat(m, "🛒 Groceries").id;
  const rent = cat(m, "🏠 Rent/Mortgage").id;
  const fun = cat(m, "🍿 Entertainment").id;
  const assign = (category_id: string, at: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month: at, category_id, assigned });
  const summary = async (q = "", at = NOV, today = TODAY) => {
    const sep = q ? `${q}&` : "?";
    const res = await send("GET", api(bid, `/months/${at}/summary${sep}today=${today}`));
    expect(res.status).toBe(200);
    return ((await res.json()) as Json).data;
  };
  return { bid, groceries, rent, fun, assign, summary };
}

describe("future_assigned on the month summary", () => {
  it("shows the next month at 0 when nothing is assigned ahead", async () => {
    const s = await seed();
    const d = await s.summary();
    expect(d.future_assigned).toEqual([{ month: "2026-12-01", assigned: 0 }]);
    expect(d.future_assigned_total).toBe(0);
    expect(Object.keys(d)).toEqual(
      expect.arrayContaining(["leftover", "assigned", "activity", "available"]),
    );
  });

  it("lists every month to the last assigned one, in order, summed, trimming trailing zeros", async () => {
    const s = await seed();
    await s.assign(s.groceries, "2026-12-01", 100000);
    await s.assign(s.rent, "2026-12-01", 30000);
    await s.assign(s.groceries, "2027-02-01", 7000);
    const d = await s.summary();
    expect(d.future_assigned).toEqual([
      { month: "2026-12-01", assigned: 130000 },
      { month: "2027-01-01", assigned: 0 },
      { month: "2027-02-01", assigned: 7000 },
    ]);
    expect(d.future_assigned_total).toBe(137000);
    await s.assign(s.groceries, "2027-05-01", 5000);
    await s.assign(s.groceries, "2027-05-01", 0);
    expect((await s.summary()).future_assigned).toHaveLength(3);
  });

  it("counts hidden categories and hidden groups, and matches the engine's assigned_in_future", async () => {
    const s = await seed();
    await s.assign(s.fun, "2026-12-01", 11000);
    await s.assign(s.rent, "2026-12-01", 22000);
    await s.assign(s.groceries, "2027-01-01", 33000);
    await send("PATCH", api(s.bid, `/categories/${s.fun}`), { hidden: true });
    const m = await month(s.bid, NOV);
    const group = m.groups.find((g) => g.categories.some((c) => c.id === s.rent));
    expect(group).toBeDefined();
    await send("PATCH", api(s.bid, `/category_groups/${group?.id}`), { hidden: true });
    const withHidden = await s.summary();
    expect(withHidden.future_assigned_total).toBe(66000);
    // delete the category with the Jan assignment, moving its money to another one
    const del = await send("DELETE", api(s.bid, `/categories/${s.groceries}?reassign_to=${s.fun}`));
    expect([200, 409, 422]).toContain(del.status);
    const d = await s.summary();
    const res = await send("GET", api(s.bid, `/months/${NOV}?today=${TODAY}`));
    const detail = ((await res.json()) as Json).data;
    expect(d.future_assigned_total).toBe(-detail.rta_breakdown.assigned_in_future);
  });

  it("covers the whole plan whatever category_ids or view say", async () => {
    const s = await seed();
    await s.assign(s.groceries, "2026-12-01", 5000);
    await s.assign(s.rent, "2027-01-01", 9000);
    const plain = await s.summary();
    for (const q of [`?category_ids=${s.groceries}`, "?view=overspent"]) {
      const d = await s.summary(q);
      expect(d.future_assigned).toEqual(plain.future_assigned);
      expect(d.future_assigned_total).toBe(plain.future_assigned_total);
    }
    expect(plain.future_assigned_total).toBe(14000);
  });

  it("is absent for a month that is not the current one", async () => {
    const s = await seed();
    await s.assign(s.groceries, "2026-12-01", 5000);
    for (const [at, today] of [
      [NOV, "2026-12-03"],
      ["2026-12-01", TODAY],
      ["2026-10-01", TODAY],
    ]) {
      const d = await s.summary("", at, today);
      expect("future_assigned" in d).toBe(false);
      expect("future_assigned_total" in d).toBe(false);
    }
  });

  it("get_month_summary returns the same fields as REST", async () => {
    const s = await seed();
    await s.assign(s.groceries, "2026-12-01", 5000);
    await s.assign(s.rent, "2027-02-01", 9000);
    const base = { budget_id: s.bid, month: NOV, today: TODAY };
    const a = await mcp("get_month_summary", base);
    expect(a.structuredContent.future_assigned).toHaveLength(3);
    expect(a.structuredContent).toEqual(await s.summary());
    const b = await mcp("get_month_summary", { ...base, category_ids: [s.groceries] });
    expect(b.structuredContent).toEqual(await s.summary(`?category_ids=${s.groceries}`));
    expect(b.structuredContent.future_assigned_total).toBe(14000);
    const c = await mcp("get_month_summary", { ...base, view: "overspent" });
    expect(c.structuredContent).toEqual(await s.summary("?view=overspent"));
    const d = await mcp("get_month_summary", { ...base, today: "2026-12-03" });
    expect("future_assigned" in d.structuredContent).toBe(false);
    expect("future_assigned_total" in d.structuredContent).toBe(false);
  });

  it("documents the optional fields in the OpenAPI schema", async () => {
    const doc = (await apiDocument()) as Json;
    const op = doc.paths["/api/v1/budgets/{budget_id}/months/{month}/summary"].get;
    let schema = op.responses["200"].content["application/json"].schema;
    const resolve = (x: Json): Json =>
      x.$ref ? resolve(doc.components.schemas[x.$ref.split("/").pop() as string]) : x;
    schema = resolve(schema);
    // `extend` renders as allOf [MonthTotals, { the optional fields }]: flatten it.
    const flat = (x: Json): Json => {
      const r = resolve(x);
      const parts: Json[] = (r.allOf ?? [r]).map((p: Json) => resolve(p));
      return {
        properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
        required: parts.flatMap((p) => p.required ?? []),
      };
    };
    const totals = flat(schema.properties.data);
    expect(Object.keys(totals.properties)).toEqual(
      expect.arrayContaining(["future_assigned", "future_assigned_total"]),
    );
    expect(totals.required).not.toContain("future_assigned");
    expect(totals.required).not.toContain("future_assigned_total");
    const item = resolve(resolve(totals.properties.future_assigned).items);
    expect(Object.keys(item.properties).sort()).toEqual(["assigned", "month"]);
  });
});
