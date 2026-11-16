import { describe, expect, it } from "vitest";
import { actor, api, type Json, mcp, send } from "./category-helpers";
import { MONTHLY100, NOV, seedPlan, TODAY } from "./plan-fixtures";
import { apiDocument } from "./surface";

async function seed() {
  const s = await seedPlan(["Over", "Under", "Snoozed", "Funded", "Zero", "Hidden"]);
  await s.target("Under", MONTHLY100);
  await s.target("Snoozed", MONTHLY100);
  await s.target("Funded", MONTHLY100);
  await s.assign("Funded", NOV, 150000);
  await s.assign("Under", NOV, 40000);
  await s.assign("Snoozed", NOV, 40000);
  await s.assign("Over", NOV, 10000);
  await s.spend("Over", "2026-11-05", 60000);
  await s.assign("Hidden", NOV, -1000);
  await send(
    "PUT",
    api(s.bid, `/months/${NOV}/categories/${s.ids.Snoozed}/target-snooze?today=${TODAY}`),
    {
      snoozed: true,
    },
  );
  await send("PATCH", api(s.bid, `/categories/${s.ids.Hidden}`), { hidden: true });
  const read = async (view?: string) => {
    const q = `?today=${TODAY}${view ? `&view=${view}` : ""}`;
    const res = await send("GET", api(s.bid, `/months/${NOV}${q}`));
    expect(res.status).toBe(200);
    return ((await res.json()) as Json).data;
  };
  const names = (d: Json) =>
    d.groups
      .flatMap((g: Json) => g.categories.map((c: Json) => c.name))
      .filter((n: string) => /^[A-Z][a-z]+$/.test(n))
      .sort();
  return { ...s, read, names };
}

describe("month read views", () => {
  it("each view lists exactly its categories, and the tool agrees", async () => {
    const s = await seed();
    const expected: Record<string, string[]> = {
      all: ["Funded", "Hidden", "Over", "Snoozed", "Under", "Zero"],
      overspent: ["Over"],
      underfunded: ["Over", "Under"],
      overfunded: ["Funded"],
      money_available: ["Funded", "Snoozed", "Under"],
      snoozed: ["Snoozed"],
    };
    for (const [view, want] of Object.entries(expected)) {
      const d = await s.read(view);
      expect(s.names(d), view).toEqual(want);
      const t = await mcp("get_plan_month", { budget_id: s.bid, month: NOV, view, today: TODAY });
      expect(t.structuredContent, view).toEqual(d);
    }
  });

  it("re-sums the group subtotals over the visible categories and omits empty groups", async () => {
    const s = await seed();
    const d = await s.read("overspent");
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]).toMatchObject({ assigned: 10000, activity: -60000, available: -50000 });
    const none = await s.read("overfunded");
    expect(none.groups[0].categories).toHaveLength(1);
  });

  it("the summary with a view totals exactly the listed categories", async () => {
    const s = await seed();
    for (const view of ["overspent", "money_available", "snoozed", "underfunded"]) {
      const d = await s.read(view);
      const cats = d.groups.flatMap((g: Json) => g.categories) as Json[];
      const sum = (k: string) => cats.reduce((n, c) => n + c[k], 0);
      const res = await send(
        "GET",
        api(s.bid, `/months/${NOV}/summary?view=${view}&today=${TODAY}`),
      );
      const body = ((await res.json()) as Json).data;
      expect(body, view).toEqual({
        leftover: sum("carried"),
        assigned: sum("assigned"),
        activity: sum("activity"),
        available: sum("available"),
      });
      const t = await mcp("get_month_summary", {
        budget_id: s.bid,
        month: NOV,
        view,
        today: TODAY,
      });
      expect(t.structuredContent).toEqual(body);
    }
  });

  it("refuses category_ids with view, on both surfaces", async () => {
    const s = await seed();
    const res = await send(
      "GET",
      api(s.bid, `/months/${NOV}/summary?view=snoozed&category_ids=${s.ids.Over}`),
    );
    expect(res.status).toBe(422);
    const t = await mcp("get_month_summary", {
      budget_id: s.bid,
      month: NOV,
      view: "snoozed",
      category_ids: [s.ids.Over],
    });
    expect(t.isError).toBe(true);
    expect((await send("GET", api(s.bid, `/months/${NOV}?view=nope`))).status).toBe(422);
  });

  it("target_snoozed follows the row; a category without a target is false", async () => {
    const s = await seed();
    const d = await s.read();
    const by = (n: string) =>
      (d.groups.flatMap((g: Json) => g.categories) as Json[]).find((c) => c.name === n);
    expect(by("Snoozed").target_snoozed).toBe(true);
    expect(by("Snoozed").target.status).toBe("snoozed");
    expect(by("Under").target_snoozed).toBe(false);
    expect(by("Zero").target_snoozed).toBe(false);
    expect(actor).toBeTruthy();
  });

  it("documents the view query on both reads", async () => {
    const doc = (await apiDocument()) as unknown as {
      paths: Record<string, { get?: { parameters?: { name: string }[] } }>;
    };
    for (const p of [
      "/api/v1/budgets/{budget_id}/months/{month}",
      "/api/v1/budgets/{budget_id}/months/{month}/summary",
    ]) {
      expect(doc.paths[p]?.get?.parameters?.map((x) => x.name)).toContain("view");
    }
  });
});
