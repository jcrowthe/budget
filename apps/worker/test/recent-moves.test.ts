import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { autoAssign } from "../src/services/auto-assign";
import { createBudget } from "../src/services/budgets";
import { setAssigned } from "../src/services/months";
import { recentMovesClock } from "../src/services/recent-moves";
import { actor as ACTOR } from "./category-helpers";
import { json } from "./helpers";
import { DEC, MONTHLY100, NOV, seedPlan, TODAY } from "./plan-fixtures";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";
import { undo } from "./undo-helpers";

const PATH = "/api/v1/budgets/{budget_id}/moves";
const RTA = "ready_to_assign";
const realNow = recentMovesClock.now;
afterEach(() => {
  recentMovesClock.now = realNow;
});

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

async function seed() {
  const b = await createBudget(env, ACTOR, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const d = (await (await json(`/api/v1/budgets/${b.id}/months/${NOV}`)).json()) as Json;
  const ids: string[] = d.data.groups.flatMap((g: Json) => g.categories.map((c: Json) => c.id));
  return { bid: b.id, a: ids[0] as string, b: ids[1] as string, c: ids[2] as string };
}
const assign = (bid: string, cid: string, assigned: number, month = NOV) =>
  setAssigned(env, ACTOR, { budget_id: bid, month, category_id: cid, assigned });
const move = (bid: string, body: unknown, month = NOV) =>
  json(`/api/v1/budgets/${bid}/months/${month}/moves`, { method: "POST" }, body);
const cover = (bid: string, cid: string, body: unknown, month = NOV) =>
  json(`/api/v1/budgets/${bid}/months/${month}/categories/${cid}/cover`, { method: "POST" }, body);
const list = async (bid: string, q = "") => {
  const res = await json(`/api/v1/budgets/${bid}/moves${q}`);
  return { status: res.status, body: (await res.json()) as Json };
};
const entries = async (bid: string, q = ""): Promise<Json[]> => {
  const r = await list(bid, q);
  expect(r.status).toBe(200);
  return r.body.data;
};
const side = (category_id: string, month = NOV) =>
  expect.objectContaining({ category_id, month, category_name: expect.any(String) });

describe("recent moves: surface", () => {
  it("lists the path and the tool", async () => {
    expect(await apiPaths()).toContain(PATH);
    expect(await listedToolNames()).toContain("list_recent_moves");
  });
});

describe("recent moves: direct edits", () => {
  it("lists assigned and removed deltas, and nothing for an unchanged value", async () => {
    const { bid, a } = await seed();
    await assign(bid, a, 100000);
    await assign(bid, a, 450000);
    await assign(bid, a, 450000);
    await assign(bid, a, 1234500);
    await assign(bid, a, 200000);
    const got = await entries(bid);
    expect(got.map((e) => [e.kind, e.amount])).toEqual([
      ["removed", 1034500],
      ["assigned", 784500],
      ["assigned", 350000],
      ["assigned", 100000],
    ]);
    expect(got[3]).toMatchObject({
      kind: "assigned",
      amount: 100000,
      from: null,
      to: side(a),
      method: "edit",
      undo_of: null,
    });
    expect(got[0]).toMatchObject({ kind: "removed", to: null, from: side(a) });
  });
});

describe("recent moves: moves and covers", () => {
  it("lists a category to category move as one entry", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 475000);
    const res = await move(bid, { from: a, to: b, amount: 75000 });
    const moveId = ((await res.json()) as Json).data.move_id;
    const got = (await entries(bid)).filter((e) => e.method === "move");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: moveId,
      kind: "moved",
      amount: 75000,
      from: side(a),
      to: side(b),
      method: "move",
      undo_of: null,
    });
  });

  it("lists a move to Ready to Assign as removed and one from it as assigned", async () => {
    const { bid, a, c } = await seed();
    await assign(bid, a, 50000);
    await move(bid, { from: a, to: RTA, amount: 20000 });
    await move(bid, { from: RTA, to: c, amount: 10000 });
    const got = (await entries(bid)).filter((e) => e.method === "move");
    expect(got[0]).toMatchObject({ kind: "assigned", amount: 10000, from: null, to: side(c) });
    expect(got[1]).toMatchObject({ kind: "removed", amount: 20000, to: null, from: side(a) });
  });

  it("lists covers from Ready to Assign and from a category as method cover", async () => {
    const { bid, a, b, c } = await seed();
    await assign(bid, a, -70000);
    await assign(bid, b, 275000);
    await cover(bid, a, { from: b });
    await assign(bid, c, -5000);
    await cover(bid, c, { from: RTA });
    const got = (await entries(bid)).filter((e) => e.method === "cover");
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ kind: "assigned", amount: 5000, from: null, to: side(c) });
    expect(got[1]).toMatchObject({ kind: "moved", amount: 70000, from: side(b), to: side(a) });
  });
});

describe("recent moves: auto-assign", () => {
  it("lists one assigned entry per changed cell with method auto_assign", async () => {
    const s = await seedPlan(["W", "X"]);
    await s.target("W", MONTHLY100);
    await s.target("X", MONTHLY100);
    await autoAssign(env, ACTOR, {
      budget_id: s.bid,
      month: DEC,
      strategy: "underfunded",
      today: TODAY,
    } as Json);
    const got = (await entries(s.bid)).filter((e) => e.method === "auto_assign");
    expect(got).toHaveLength(2);
    for (const e of got) expect(e).toMatchObject({ kind: "assigned", from: null });
  });
});

describe("recent moves: undo", () => {
  it("lists an undone move as a second entry with the sides swapped", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    const res = await move(bid, { from: a, to: b, amount: 40000 });
    const moveId = ((await res.json()) as Json).data.move_id;
    const setId = res.headers.get("Budget-Change-Set") as string;
    const u = await undo(bid, setId);
    expect(u.status).toBe(200);
    const got = await entries(bid);
    const back = got.find((e) => e.method === "undo");
    expect(back).toMatchObject({
      kind: "moved",
      amount: 40000,
      from: side(b),
      to: side(a),
      undo_of: moveId,
    });
    expect(got.filter((e) => e.id === moveId)).toHaveLength(1);
  });

  it("lists an undone edit with the delta reversed and undo_of the change set", async () => {
    const { bid, a } = await seed();
    const res = await json(
      `/api/v1/budgets/${bid}/months/${NOV}/categories/${a}`,
      { method: "PATCH" },
      { assigned: 300000 },
    );
    const setId = res.headers.get("Budget-Change-Set") as string;
    expect((await undo(bid, setId)).status).toBe(200);
    const back = (await entries(bid)).find((e) => e.method === "undo");
    expect(back).toMatchObject({
      kind: "removed",
      amount: 300000,
      from: side(a),
      to: null,
      undo_of: setId,
    });
  });
});

describe("recent moves: category delete", () => {
  it("adds no entry for a merge", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    const before = (await entries(bid)).length;
    const res = await json(`/api/v1/budgets/${bid}/categories/${a}?reassign_to=${b}`, {
      method: "DELETE",
    });
    expect(res.status).toBeLessThan(300);
    const after = await entries(bid);
    expect(after).toHaveLength(before);
    expect(after.some((e) => e.from?.deleted || e.to?.deleted)).toBe(true);
  });

  it("keeps a deleted category's name and marks it deleted", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    await move(bid, { from: a, to: b, amount: 1000 });
    const res = await json(`/api/v1/budgets/${bid}/categories/${a}?reassign_to=${b}`, {
      method: "DELETE",
    });
    expect(res.status).toBeLessThan(300);
    const e = (await entries(bid)).find((x) => x.method === "move");
    expect(e.from).toMatchObject({ category_id: a, deleted: true });
    expect(e.from.category_name.length).toBeGreaterThan(0);
    expect(e.to.deleted).toBe(false);
  });
});

describe("recent moves: window", () => {
  const T = new Date("2026-12-30T12:00:00.000Z");
  const stamp = (bid: string, at: string) =>
    env.DB.prepare(
      "UPDATE change_log SET created_at = ? WHERE budget_id = ? AND entity_type = 'month_category'",
    )
      .bind(at, bid)
      .run();

  it("includes exactly now − 34 days and excludes one millisecond before", async () => {
    const { bid, a } = await seed();
    recentMovesClock.now = () => T;
    await assign(bid, a, 1000);
    await stamp(bid, new Date(T.getTime() - 34 * 86400000).toISOString());
    expect(await entries(bid)).toHaveLength(1);
    await stamp(bid, new Date(T.getTime() - 34 * 86400000 - 1).toISOString());
    expect(await entries(bid)).toHaveLength(0);
  });

  it("honours since as a date and as a date-time", async () => {
    const { bid, a } = await seed();
    recentMovesClock.now = () => T;
    await assign(bid, a, 1000);
    await stamp(bid, "2026-12-20T00:00:00.000Z");
    expect(await entries(bid, "?since=2026-12-20")).toHaveLength(1);
    expect(await entries(bid, "?since=2026-12-20T00:00:00.001Z")).toHaveLength(0);
    expect(await entries(bid, "?since=2026-12-21")).toHaveLength(0);
  });

  it("lists a move made today for next month's cell", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 1000, "2027-06-01");
    await move(bid, { from: a, to: b, amount: 500 }, "2027-06-01");
    const got = await entries(bid);
    expect(got.find((e) => e.method === "move")?.to.month).toBe("2027-06-01");
  });
});

describe("recent moves: type filter", () => {
  it("splits moved and assigned disjointly, newest first", async () => {
    const { bid, a, b, c } = await seed();
    await assign(bid, a, 100000);
    await move(bid, { from: a, to: b, amount: 1000 });
    await move(bid, { from: a, to: RTA, amount: 2000 });
    await move(bid, { from: RTA, to: c, amount: 3000 });
    const all = await entries(bid);
    const moved = await entries(bid, "?type=moved");
    const assigned = await entries(bid, "?type=assigned");
    expect(moved.map((e) => e.amount).sort()).toEqual([1000, 2000]);
    expect(assigned.map((e) => e.amount).sort()).toEqual([100000, 3000]);
    expect([...moved, ...assigned].map((e) => e.id).sort()).toEqual(all.map((e) => e.id).sort());
    expect(await entries(bid, "?type=all")).toEqual(all);
    const ats = all.map((e) => e.at);
    expect(ats).toEqual([...ats].sort().reverse());
  });
});

describe("recent moves: names", () => {
  it("names the actor from the email, also over MCP", async () => {
    const { bid, a } = await seed();
    await assign(bid, a, 1000);
    const [e] = await entries(bid);
    expect(e.actor).toEqual({ id: ACTOR, name: "tester", initial: "T" });
    await env.DB.prepare("UPDATE change_log SET actor = ? WHERE budget_id = ?")
      .bind(`mcp:${ACTOR}`, bid)
      .run();
    const [m] = await entries(bid);
    expect(m.actor).toEqual({ id: `mcp:${ACTOR}`, name: "tester", initial: "T" });
  });
});

describe("recent moves: isolation and errors", () => {
  it("never lists another plan's moves", async () => {
    const x = await seed();
    const y = await seed();
    await assign(x.bid, x.a, 1000);
    expect(await entries(y.bid)).toHaveLength(0);
  });

  it("answers 404 for an unknown plan and 422 for a bad type or since", async () => {
    const { bid } = await seed();
    expect((await list(crypto.randomUUID())).status).toBe(404);
    expect((await list(bid, "?type=bogus")).status).toBe(422);
    expect((await list(bid, "?since=nope")).status).toBe(422);
  });
});

describe("recent moves: REST equals MCP", () => {
  it("returns the same data", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    await move(bid, { from: a, to: b, amount: 1000 });
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const since = "2020-01-01";
    for (const [args, q] of [
      [{}, ""],
      [{ type: "moved" }, "?type=moved"],
      [{ type: "assigned", since }, `?type=assigned&since=${since}`],
    ] as [Json, string][]) {
      const r = (
        await mcpRpc(
          "tools/call",
          { name: "list_recent_moves", arguments: { budget_id: bid, ...args } },
          2,
        )
      ).body.result as Json;
      expect(r.isError).toBeFalsy();
      const rest = await entries(bid, q);
      expect(rest.length).toBeGreaterThan(0);
      // MCP structured content is an object: the same array travels as `moves`
      expect(r.structuredContent.moves).toEqual(rest);
    }
  });
});
