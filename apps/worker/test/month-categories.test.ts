import { env } from "cloudflare:test";
import { MonthDetailResponse } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

const PATH = "/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}";
const NOV = "2026-11-01";
const actor = "user:tester@localhost";

type Detail = ReturnType<typeof MonthDetailResponse.parse>["data"];
async function readMonth(bid: string, month = NOV): Promise<Detail> {
  const res = await json(`/api/v1/budgets/${bid}/months/${month}`);
  expect(res.status).toBe(200);
  return MonthDetailResponse.parse(await res.json()).data;
}
async function seed() {
  const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const d = await readMonth(b.id);
  const cats = d.groups.flatMap((g) => g.categories);
  return { bid: b.id, c1: cats[0]?.id as string, c2: cats[1]?.id as string };
}
const patch = (bid: string, month: string, cid: string, body: unknown) =>
  json(`/api/v1/budgets/${bid}/months/${month}/categories/${cid}`, { method: "PATCH" }, body);
const logRows = (bid: string) =>
  env.DB.prepare(
    "SELECT actor, entity_type, action, entity_id, before_json, after_json FROM change_log WHERE budget_id = ? AND entity_type = 'month_category'",
  )
    .bind(bid)
    .all<{
      actor: string;
      action: string;
      entity_id: string;
      before_json: string;
      after_json: string;
    }>();

describe("PATCH month category (REST)", () => {
  it("sets Assigned, answers like the read model and logs one row", async () => {
    const { bid, c1 } = await seed();
    const res = await patch(bid, NOV, c1, { assigned: 400000 });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { category: Record<string, unknown>; ready_to_assign: number };
    };
    const after = await readMonth(bid);
    const cat = after.groups.flatMap((g) => g.categories).find((c) => c.id === c1);
    expect(data.category).toEqual({
      id: c1,
      month: NOV,
      assigned: 400000,
      activity: cat?.activity,
      available: cat?.available,
    });
    expect(data.category.assigned).toBe(400000);
    expect(data.ready_to_assign).toBe(after.ready_to_assign);
    expect(after.ready_to_assign).toBe(-400000);
    const rows = (await logRows(bid)).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor, action: "update", entity_id: `${c1}:${NOV}` });
    expect(JSON.parse(rows[0]?.before_json ?? "{}").assigned).toBe(0);
    expect(JSON.parse(rows[0]?.after_json ?? "{}").assigned).toBe(400000);
  });

  it("accepts a negative amount", async () => {
    const { bid, c1 } = await seed();
    const res = await patch(bid, NOV, c1, { assigned: -5000 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { ready_to_assign: number } }).data.ready_to_assign).toBe(
      5000,
    );
  });

  it("answers 404 for an unknown plan or category", async () => {
    const { bid, c1 } = await seed();
    const other = await seed();
    const uuid = crypto.randomUUID();
    for (const [b, c] of [
      [uuid, c1],
      ["not-a-uuid", c1],
      [bid, uuid],
      [bid, "not-a-uuid"],
      [bid, other.c1],
    ] as const) {
      expect((await patch(b, NOV, c, { assigned: 1000 })).status).toBe(404);
    }
  });

  it("answers 404 for a deleted plan", async () => {
    const { bid, c1 } = await seed();
    expect((await json(`/api/v1/budgets/${bid}`, { method: "DELETE" })).status).toBeLessThan(300);
    expect((await patch(bid, NOV, c1, { assigned: 1000 })).status).toBe(404);
  });

  it("answers 422 for a bad month or amount", async () => {
    const { bid, c1 } = await seed();
    for (const m of ["2026-11-15", "2026-13-01", "nov", "1800-01-01", "2300-01-01"]) {
      expect((await patch(bid, m, c1, { assigned: 1000 })).status).toBe(422);
    }
    for (const body of [{}, { assigned: "5" }, { assigned: 1.5 }, { assigned: 2 ** 60 }]) {
      expect((await patch(bid, NOV, c1, body)).status).toBe(422);
    }
    expect((await logRows(bid)).results).toHaveLength(0);
  });
});

describe("set_assigned (MCP)", () => {
  it("answers like REST and logs the MCP actor", async () => {
    const { bid, c2 } = await seed();
    const res = await mcpRpc(
      "tools/call",
      {
        name: "set_assigned",
        arguments: { budget_id: bid, month: NOV, category_id: c2, assigned: 25000 },
      },
      3,
    );
    const sc = res.body.result?.structuredContent as {
      category: Record<string, unknown>;
      ready_to_assign: number;
    };
    const after = await readMonth(bid);
    const cat = after.groups.flatMap((g) => g.categories).find((c) => c.id === c2);
    expect(sc.category).toEqual({
      id: c2,
      month: NOV,
      assigned: 25000,
      activity: cat?.activity,
      available: cat?.available,
    });
    expect(sc.ready_to_assign).toBe(after.ready_to_assign);
    const rows = (await logRows(bid)).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(`mcp:${actor}`);
    expect(JSON.parse(rows[0]?.after_json ?? "{}").assigned).toBe(25000);
  });

  it("returns a tool error for an unknown category", async () => {
    const { bid } = await seed();
    const res = await mcpRpc(
      "tools/call",
      {
        name: "set_assigned",
        arguments: { budget_id: bid, month: NOV, category_id: crypto.randomUUID(), assigned: 1 },
      },
      4,
    );
    const r = res.body.result as { isError?: boolean; content?: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content?.[0]?.text.toLowerCase()).toContain("not found");
  });
});

describe("surface", () => {
  it("lists the path and the tool", async () => {
    expect(await apiPaths()).toContain(PATH);
    expect(await listedToolNames()).toContain("set_assigned");
  });
});
