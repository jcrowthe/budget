import { env } from "cloudflare:test";
import { MonthDetailResponse } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLogInsert } from "../src/history/change-log";
import { createBudget } from "../src/services/budgets";
import { buildMoveBatch, setAssigned } from "../src/services/months";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

const MOVES = "/api/v1/budgets/{budget_id}/months/{month}/moves";
const COVER = "/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/cover";
const NOV = "2026-11-01";
const actor = "user:tester@localhost";
const RTA = "ready_to_assign";

type Detail = ReturnType<typeof MonthDetailResponse.parse>["data"];
async function readMonth(bid: string, month = NOV): Promise<Detail> {
  const res = await json(`/api/v1/budgets/${bid}/months/${month}`);
  expect(res.status).toBe(200);
  return MonthDetailResponse.parse(await res.json()).data;
}
const cell = (d: Detail, id: string) =>
  d.groups.flatMap((g) => g.categories).find((c) => c.id === id);
async function seed() {
  const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const d = await readMonth(b.id);
  const cats = d.groups.flatMap((g) => g.categories);
  const ids = cats.map((c) => c.id);
  return { bid: b.id, a: ids[0] as string, b: ids[1] as string, c: ids[2] as string };
}
const move = (bid: string, body: unknown, month = NOV) =>
  json(`/api/v1/budgets/${bid}/months/${month}/moves`, { method: "POST" }, body);
const cover = (bid: string, cid: string, body: unknown, month = NOV) =>
  json(`/api/v1/budgets/${bid}/months/${month}/categories/${cid}/cover`, { method: "POST" }, body);
const assign = (bid: string, cid: string, assigned: number) =>
  setAssigned(env, actor, { budget_id: bid, month: NOV, category_id: cid, assigned });
const logRows = async (bid: string) =>
  (
    await env.DB.prepare(
      "SELECT actor, entity_id, before_json, after_json FROM change_log WHERE budget_id = ? AND entity_type = 'month_category' ORDER BY created_at",
    )
      .bind(bid)
      .all<{ actor: string; entity_id: string; before_json: string; after_json: string }>()
  ).results;
type Result = {
  move_id: string;
  month: string;
  amount: number;
  from: { id: string; assigned: number; available: number } | null;
  to: { id: string; assigned: number; available: number } | null;
  ready_to_assign: number;
};
const data = async (res: Response) => ((await res.json()) as { data: Result }).data;
async function mcp(name: string, args: Record<string, unknown>) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as unknown as {
    isError?: boolean;
    structuredContent?: Result;
    content?: { text: string }[];
  };
}

describe("moves: surface", () => {
  it("lists the paths and the tools", async () => {
    expect(await apiPaths()).toEqual(expect.arrayContaining([MOVES, COVER]));
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["move_money", "cover_overspending"]),
    );
  });
});

describe("POST moves", () => {
  it("moves between categories, leaving Ready to Assign, and matches the read model", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 475000);
    await assign(bid, b, 200000);
    const rta = (await readMonth(bid)).ready_to_assign;
    const res = await move(bid, { from: a, to: b, amount: 75000 });
    expect(res.status).toBe(200);
    const r = await data(res);
    const after = await readMonth(bid);
    expect(r.from).toEqual({ id: a, month: NOV, assigned: 400000, activity: 0, available: 400000 });
    expect(r.to?.assigned).toBe(275000);
    expect(cell(after, b)?.available).toBe(275000);
    expect(r.ready_to_assign).toBe(rta);
    expect(after.ready_to_assign).toBe(rta);
    expect(r.amount).toBe(75000);
  });

  it("moves to and from Ready to Assign", async () => {
    const { bid, a } = await seed();
    await assign(bid, a, 400000);
    const rta = (await readMonth(bid)).ready_to_assign;
    const toRta = await data(await move(bid, { from: a, to: RTA, amount: 50000 }));
    expect(toRta.to).toBeNull();
    expect(toRta.from?.assigned).toBe(350000);
    expect(toRta.ready_to_assign).toBe(rta + 50000);
    const fromRta = await data(await move(bid, { from: RTA, to: a, amount: 20000 }));
    expect(fromRta.from).toBeNull();
    expect(fromRta.to?.assigned).toBe(370000);
    expect(fromRta.ready_to_assign).toBe(rta + 30000);
  });

  it("allows moving more than Available", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 30000);
    const r = await data(await move(bid, { from: a, to: b, amount: 100000 }));
    expect(r.from).toMatchObject({ assigned: -70000, available: -70000 });
  });

  it("covers an overspent category from another and from Ready to Assign", async () => {
    const { bid, a, b, c } = await seed();
    await assign(bid, a, -70000);
    await assign(bid, b, 275000);
    const r = await data(await cover(bid, a, { from: b }));
    expect(r.amount).toBe(70000);
    expect(r.to).toMatchObject({ id: a, assigned: 0, available: 0 });
    expect(r.from).toMatchObject({ id: b, available: 205000 });
    await assign(bid, c, -5000);
    const r2 = await data(await cover(bid, c, { from: RTA }));
    expect(r2.from).toBeNull();
    expect(r2.to?.available).toBe(0);
  });
});

describe("moves: history", () => {
  it("writes two rows with one move id for a two-sided move, one for a one-sided move", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    const base = (await logRows(bid)).length;
    const r = await data(await move(bid, { from: a, to: b, amount: 25000 }));
    const rows = (await logRows(bid)).slice(base);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.actor).toBe(actor);
      expect(JSON.parse(row.after_json).move).toEqual({
        id: r.move_id,
        month: NOV,
        from_category_id: a,
        to_category_id: b,
        amount: 25000,
        kind: "move",
      });
    }
    await move(bid, { from: RTA, to: a, amount: 1000 });
    expect((await logRows(bid)).slice(base + 2)).toHaveLength(1);
  });

  it("records a cover as kind cover", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, -1000);
    await assign(bid, b, 5000);
    const base = (await logRows(bid)).length;
    await cover(bid, a, { from: b });
    const rows = (await logRows(bid)).slice(base);
    expect(rows.map((r) => JSON.parse(r.after_json).move.kind)).toEqual(["cover", "cover"]);
  });
});

describe("moves: MCP parity", () => {
  it("gives the same numbers and rows with an mcp actor", async () => {
    const one = await seed();
    const two = await seed();
    for (const s of [one, two]) {
      await assign(s.bid, s.a, 300000);
      await assign(s.bid, s.b, -20000);
    }
    const rest = await data(await move(one.bid, { from: one.a, to: one.c, amount: 40000 }));
    const viaMcp = await mcp("move_money", {
      budget_id: two.bid,
      month: NOV,
      from: two.a,
      to: two.c,
      amount: 40000,
    });
    expect(viaMcp.isError).toBeFalsy();
    expect(viaMcp.structuredContent?.from?.assigned).toBe(rest.from?.assigned);
    expect(viaMcp.structuredContent?.to?.assigned).toBe(rest.to?.assigned);
    expect(viaMcp.structuredContent?.ready_to_assign).toBe(rest.ready_to_assign);
    const rows = await logRows(two.bid);
    expect(rows.slice(-2).every((r) => r.actor.startsWith("mcp:"))).toBe(true);
    const cov = await mcp("cover_overspending", {
      budget_id: two.bid,
      month: NOV,
      category_id: two.b,
      from: two.a,
    });
    expect(cov.structuredContent?.to?.available).toBe(0);
    expect(cov.structuredContent?.amount).toBe(20000);
  });

  it("rejects a bad month and amount as tool errors", async () => {
    const { bid, a, b } = await seed();
    const bad = await mcp("move_money", {
      budget_id: bid,
      month: "2026-11-15",
      from: a,
      to: b,
      amount: 1,
    });
    expect(bad.isError).toBe(true);
    const zero = await mcp("move_money", { budget_id: bid, month: NOV, from: a, to: b, amount: 0 });
    expect(zero.isError).toBe(true);
    const same = await mcp("move_money", {
      budget_id: bid,
      month: NOV,
      from: RTA,
      to: RTA,
      amount: 5,
    });
    expect(same.isError).toBe(true);
  });
});

describe("moves: errors", () => {
  it("answers 404 and 422 in the envelope", async () => {
    const { bid, a, b } = await seed();
    const unknown = crypto.randomUUID();
    const cases: [Response, number, string][] = [
      [await move(unknown, { from: a, to: b, amount: 1 }), 404, "not_found"],
      [await move(bid, { from: unknown, to: b, amount: 1 }), 404, "not_found"],
      [await move(bid, { from: "nope", to: b, amount: 1 }), 404, "not_found"],
      [await move(bid, { from: a, to: b, amount: 1 }, "2026-11-15"), 422, "unprocessable_entity"],
      [await move(bid, { from: a, to: b, amount: 0 }), 422, "unprocessable_entity"],
      [await move(bid, { from: a, to: b, amount: -5 }), 422, "unprocessable_entity"],
      [await move(bid, { from: a, to: b, amount: 1.5 }), 422, "unprocessable_entity"],
      [await move(bid, { from: a, to: a, amount: 5 }), 422, "unprocessable_entity"],
      [await move(bid, { from: RTA, to: RTA, amount: 5 }), 422, "unprocessable_entity"],
      [await cover(bid, a, { from: b }), 422, "error"],
      [await cover(bid, unknown, { from: b }), 404, "not_found"],
      [await cover(bid, "nope", { from: b }), 404, "not_found"],
    ];
    for (const [res, status, name] of cases) {
      expect(res.status).toBe(status);
      const body = (await res.json()) as { error: { id: string; name: string; detail: string } };
      expect(body.error.id).toBe(String(status));
      expect(body.error.name).toBe(name);
      expect(typeof body.error.detail).toBe("string");
    }
    await assign(bid, a, -1000);
    expect((await cover(bid, a, { from: a })).status).toBe(422);
  });
});

describe("moves: atomicity", () => {
  it("changes neither cell nor the log when a statement of the batch fails", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    const db = getDb(env);
    const v = {
      budget_id: bid,
      month: NOV,
      from_category_id: a,
      to_category_id: b,
      amount: 30000,
    };
    const reads = [
      { id: a, delta: -30000, before: 100000 as number | undefined },
      { id: b, delta: 30000, before: undefined as number | undefined },
    ];
    const { stmts } = buildMoveBatch(
      db,
      actor,
      v,
      crypto.randomUUID(),
      reads,
      new Date().toISOString(),
    );
    const bad = changeLogInsert(db, {
      budgetId: bid,
      actor,
      action: "update",
      entityType: "x",
      entityId: null as unknown as string,
      before: null,
      after: null,
    });
    const before = await readMonth(bid);
    const logs = (await logRows(bid)).length;
    const all = [...stmts, bad];
    await expect(
      db.batch(all as [(typeof all)[number], ...(typeof all)[number][]]),
    ).rejects.toThrow();
    const after = await readMonth(bid);
    expect(cell(after, a)?.assigned).toBe(cell(before, a)?.assigned);
    expect(cell(after, b)?.assigned).toBe(0);
    expect((await logRows(bid)).length).toBe(logs);
  });
});
