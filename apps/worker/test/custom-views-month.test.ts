import { describe, expect, it } from "vitest";
import { api, type Json, mcp, send } from "./category-helpers";
import { NOV, seedPlan, TODAY } from "./plan-fixtures";

async function seed() {
  const s = await seedPlan(["Rent", "Phone", "Food", "Fun"]);
  await s.assign("Rent", NOV, 100000);
  await s.assign("Phone", NOV, 20000);
  await s.assign("Food", NOV, 50000);
  await s.assign("Fun", NOV, 9000);
  await s.spend("Phone", "2026-11-05", 25000);
  const make = async (name: string, ...cats: string[]) => {
    const res = await send("POST", api(s.bid, "/views"), {
      name,
      category_ids: cats.map((c) => s.ids[c]),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.view.id as string;
  };
  const read = async (qs: string, bid = s.bid) => {
    const res = await send("GET", api(bid, `/months/${NOV}?today=${TODAY}${qs}`));
    return { status: res.status, body: (await res.json()) as Json };
  };
  const names = (d: Json) =>
    d.groups.flatMap((g: Json) => g.categories.map((c: Json) => c.name)) as string[];
  return { ...s, make, read, names };
}

describe("month read with view_id", () => {
  it("returns the view's members, grouped, with subtotals over them and no uncategorized", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent", "Phone");
    const { status, body } = await s.read(`&view_id=${v}`);
    expect(status).toBe(200);
    expect(s.names(body.data)).toEqual(["Rent", "Phone"]);
    expect(body.data.uncategorized).toBeNull();
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0]).toMatchObject({
      assigned: 120000,
      activity: -25000,
      available: 95000,
    });
  });
  it("an empty view has no groups", async () => {
    const s = await seed();
    const v = await s.make("ZZ Empty");
    expect((await s.read(`&view_id=${v}`)).body.data.groups).toEqual([]);
  });
  it("a hidden member is left out and comes back when unhidden", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent", "Phone");
    await send("PATCH", api(s.bid, `/categories/${s.ids.Rent}`), { hidden: true });
    expect(s.names((await s.read(`&view_id=${v}`)).body.data)).toEqual(["Phone"]);
    await send("PATCH", api(s.bid, `/categories/${s.ids.Rent}`), { hidden: false });
    expect(s.names((await s.read(`&view_id=${v}`)).body.data)).toEqual(["Rent", "Phone"]);
  });
  it("a deleted category drops out", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent", "Phone");
    const del = await send(
      "DELETE",
      api(s.bid, `/categories/${s.ids.Fun}?reassign_to=${s.ids.Food}`),
    );
    expect(del.status).toBe(200);
    expect(s.names((await s.read(`&view_id=${v}`)).body.data)).toEqual(["Rent", "Phone"]);
    const del2 = await send(
      "DELETE",
      api(s.bid, `/categories/${s.ids.Phone}?reassign_to=${s.ids.Food}`),
    );
    expect(del2.status).toBe(200);
    expect(s.names((await s.read(`&view_id=${v}`)).body.data)).toEqual(["Rent"]);
  });
  it("unknown, deleted, other-plan and built-in ids are 404, never all categories", async () => {
    const s = await seed();
    const other = await seed();
    const mine = await s.make("ZZ Mine", "Rent");
    const gone = await s.make("ZZ Gone", "Rent");
    await send("DELETE", api(s.bid, `/views/${gone}`));
    const theirs = await other.make("ZZ Theirs", "Rent");
    for (const id of ["nope", gone, theirs, "underfunded"]) {
      const r = await s.read(`&view_id=${id}`);
      expect(r.status, id).toBe(404);
      expect(r.body.error.detail).toBe("View not found");
    }
    expect((await s.read(`&view_id=${mine}`)).status).toBe(200);
  });
  it("view with view_id is 422", async () => {
    const s = await seed();
    const v = await s.make("ZZ", "Rent");
    expect((await s.read(`&view=underfunded&view_id=${v}`)).status).toBe(422);
  });
  it("without view_id the read is unchanged by the existence of views", async () => {
    const s = await seed();
    const before = (await s.read("")).body;
    await s.make("ZZ Bills", "Rent", "Phone");
    expect((await s.read("")).body).toEqual(before);
  });
});

describe("summary with view_id", () => {
  const sum = async (s: Awaited<ReturnType<typeof seed>>, qs: string) => {
    const res = await send("GET", api(s.bid, `/months/${NOV}/summary?today=${TODAY}${qs}`));
    return { status: res.status, body: (await res.json()) as Json };
  };
  it("totals the view's visible members; refuses category_ids and view", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent", "Phone");
    const r = await sum(s, `&view_id=${v}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      assigned: 120000,
      activity: -25000,
      available: 95000,
    });
    const viaIds = await sum(s, `&category_ids=${s.ids.Rent},${s.ids.Phone}`);
    expect(r.body.data).toEqual(viaIds.body.data);
    expect((await sum(s, `&view_id=${v}&category_ids=${s.ids.Rent}`)).status).toBe(422);
    expect((await sum(s, `&view_id=${v}&view=snoozed`)).status).toBe(422);
    expect((await sum(s, "&view_id=nope")).status).toBe(404);
  });
});

describe("MCP view_id", () => {
  it("get_plan_month and get_month_summary equal REST", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent", "Phone");
    const rest = (await s.read(`&view_id=${v}`)).body.data;
    const t = await mcp("get_plan_month", {
      budget_id: s.bid,
      month: NOV,
      view_id: v,
      today: TODAY,
    });
    expect(t.structuredContent).toEqual(rest);
    const sumRes = await send(
      "GET",
      api(s.bid, `/months/${NOV}/summary?today=${TODAY}&view_id=${v}`),
    );
    const ts = await mcp("get_month_summary", {
      budget_id: s.bid,
      month: NOV,
      view_id: v,
      today: TODAY,
    });
    expect(ts.structuredContent).toEqual(((await sumRes.json()) as Json).data);
  });
  it("the exclusivity and unknown-id errors are tool errors", async () => {
    const s = await seed();
    const v = await s.make("ZZ Bills", "Rent");
    const a = await mcp("get_plan_month", {
      budget_id: s.bid,
      month: NOV,
      view: "snoozed",
      view_id: v,
    });
    expect(a.isError).toBe(true);
    const b = await mcp("get_month_summary", {
      budget_id: s.bid,
      month: NOV,
      view_id: v,
      category_ids: [s.ids.Rent],
    });
    expect(b.isError).toBe(true);
    const c = await mcp("get_plan_month", { budget_id: s.bid, month: NOV, view_id: "nope" });
    expect(c.isError).toBe(true);
  });
});
