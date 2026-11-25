import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { setAssigned } from "../src/services/months";
import { recentMovesClock } from "../src/services/recent-moves";
import { actor as ACTOR } from "./category-helpers";
import { json } from "./helpers";
import { NOV } from "./plan-fixtures";
import { mcpRpc } from "./surface";
import { undo } from "./undo-helpers";

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
const list = async (bid: string, q = "") => {
  const res = await json(`/api/v1/budgets/${bid}/moves${q}`);
  return { status: res.status, body: (await res.json()) as Json };
};
const entries = async (bid: string, q = ""): Promise<Json[]> => {
  const r = await list(bid, q);
  expect(r.status).toBe(200);
  return r.body.data;
};
const sideOf = (e: Json) => [e.from?.category_id ?? null, e.to?.category_id ?? null];

describe("recent moves: category_id filter", () => {
  it("keeps the entries to or from that category, each move once", async () => {
    const { bid, a, b, c } = await seed();
    await assign(bid, a, 500000);
    await move(bid, { from: a, to: b, amount: 100000 });
    await move(bid, { from: b, to: c, amount: 30000 });
    await assign(bid, c, 70000);
    const ofA = await entries(bid, `?category_id=${a}`);
    expect(ofA.map((e) => [e.kind, ...sideOf(e)])).toEqual([
      ["moved", a, b],
      ["assigned", null, a],
    ]);
    const ofB = await entries(bid, `?category_id=${b}`);
    expect(ofB.map((e) => [e.kind, ...sideOf(e)])).toEqual([
      ["moved", b, c],
      ["moved", a, b],
    ]);
    const unknown = await list(bid, `?category_id=${crypto.randomUUID()}`);
    expect(unknown.status).toBe(200);
    expect(unknown.body.data).toEqual([]);
  });
});

describe("recent moves: month filter", () => {
  it("keeps one month's entries and drops the 34-day window when no since is given", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    await assign(bid, a, 50000, "2026-12-01");
    await move(bid, { from: a, to: b, amount: 1000 }, "2026-12-01");
    const nov = await entries(bid, `?month=${NOV}`);
    expect(nov).toHaveLength(1);
    expect(nov[0]).toMatchObject({ kind: "assigned", amount: 100000 });
    const dec = await entries(bid, "?month=2026-12-01");
    expect(dec.map((e) => e.method)).toEqual(["move", "edit"]);

    recentMovesClock.now = () => new Date(Date.now() + 60 * 86400000);
    expect(await entries(bid)).toEqual([]);
    expect(await entries(bid, `?month=${NOV}`)).toHaveLength(1);
    const future = new Date(Date.now() + 90 * 86400000).toISOString();
    expect(await entries(bid, `?month=${NOV}&since=${future}`)).toEqual([]);
  });
});

describe("recent moves: new query errors", () => {
  it("answers 422 for a bad month or an empty category_id", async () => {
    const { bid } = await seed();
    for (const q of ["?month=2026-11-15", "?month=nope", "?category_id="]) {
      expect((await list(bid, q)).status, q).toBe(422);
    }
  });
});

describe("recent moves: redo label", () => {
  it("labels the undo of an undo as redo, by parity", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    const res = await move(bid, { from: a, to: b, amount: 40000 });
    const u1 = await undo(bid, res.headers.get("Budget-Change-Set") as string);
    expect(u1.status).toBe(200);
    const r1 = await undo(bid, u1.header as string);
    expect(r1.status).toBe(200);
    const got = (await entries(bid)).filter((e) => e.from_move);
    expect(got.map((e) => e.method)).toEqual(["redo", "undo", "move"]);
    expect(got[0]).toMatchObject({
      kind: "moved",
      from: { category_id: a },
      to: { category_id: b },
    });
    expect(got[0].undo_of).toBe(got[1].id);
    const u2 = await undo(bid, r1.header as string);
    expect(u2.status).toBe(200);
    expect((await entries(bid)).filter((e) => e.from_move)[0].method).toBe("undo");
  });

  it("labels the redo of an edit as redo", async () => {
    const { bid, a } = await seed();
    const res = await json(
      `/api/v1/budgets/${bid}/months/${NOV}/categories/${a}`,
      { method: "PATCH" },
      { assigned: 300000 },
    );
    const u = await undo(bid, res.headers.get("Budget-Change-Set") as string);
    const r = await undo(bid, u.header as string);
    expect(r.status).toBe(200);
    const [newest, second] = await entries(bid);
    expect(newest).toMatchObject({ method: "redo", kind: "assigned", to: { category_id: a } });
    expect(second.method).toBe("undo");
  });
});

describe("recent moves: REST equals MCP with the new filters", () => {
  it("returns the same data", async () => {
    const { bid, a, b } = await seed();
    await assign(bid, a, 100000);
    await move(bid, { from: a, to: b, amount: 1000 });
    await move(bid, { from: a, to: RTA, amount: 2000 });
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    for (const [args, q] of [
      [{ category_id: a }, `?category_id=${a}`],
      [{ category_id: b, month: NOV }, `?category_id=${b}&month=${NOV}`],
      [{ month: NOV, type: "moved" }, `?month=${NOV}&type=moved`],
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
      expect(r.structuredContent.moves).toEqual(rest);
    }
  });
});
