import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { autoAssign, buildAutoAssignBatch } from "../src/services/auto-assign";
import { actor, api, type Json, logs, mcp, send } from "./category-helpers";
import { DEC, MONTHLY100, NOV, seedPlan, TODAY } from "./plan-fixtures";
import { apiPaths, listedToolNames } from "./surface";

const post = (bid: string, month: string, body: unknown) =>
  send("POST", api(bid, `/months/${month}/auto-assign?today=${TODAY}`), body);
const preview = async (bid: string, month: string, q = "") => {
  const res = await send("GET", api(bid, `/months/${month}/auto-assign?today=${TODAY}${q}`));
  return { status: res.status, body: ((await res.json()) as Json).data };
};
const assignedOf = async (bid: string, month: string, id: string) => {
  const res = await send("GET", api(bid, `/months/${month}/categories/${id}?today=${TODAY}`));
  return ((await res.json()) as Json).data;
};

/** The first worked example: monthly 100.00 target created in Nov, 100.00 assigned and 30.00 spent in Nov. */
async function worked() {
  const s = await seedPlan(["W"]);
  await s.target("W", MONTHLY100);
  await s.assign("W", NOV, 100000);
  await s.spend("W", "2026-11-05", 30000);
  const id = s.ids.W as string;
  const click = async (strategy: string) => {
    const res = await post(s.bid, DEC, { strategy, category_ids: [id] });
    expect(res.status).toBe(200);
    return assignedOf(s.bid, DEC, id);
  };
  return { ...s, id, click };
}

describe("auto-assign: first worked example", () => {
  it("previews over REST and MCP agree", async () => {
    const s = await worked();
    const want = {
      category_count: 1,
      underfunded: 100000,
      assigned_last_month: 100000,
      spent_last_month: 30000,
      average_assigned: 100000,
      average_spent: 30000,
      reduce_overfunding: 0,
      reset_available: 0,
      reset_assigned: 0,
    };
    const rest = await preview(s.bid, DEC, `&category_ids=${s.id}`);
    expect(rest.body).toEqual(want);
    const t = await mcp("preview_auto_assign", {
      budget_id: s.bid,
      month: DEC,
      category_ids: [s.id],
      today: TODAY,
    });
    expect(t.structuredContent).toEqual(want);
  });

  it("the click chain", async () => {
    const s = await worked();
    // November is the current month: leftover 70.00 carries into December.
    let c = await s.click("spent_last_month");
    expect([c.assigned, c.available]).toEqual([30000, 100000]);
    c = await s.click("assigned_last_month");
    expect([c.assigned, c.available]).toEqual([100000, 170000]);
    expect((await s.click("average_spent")).assigned).toBe(30000);
    expect((await s.click("average_assigned")).assigned).toBe(100000);
    c = await s.click("reset_available");
    expect([c.assigned, c.available]).toEqual([-70000, 0]);
    expect((await s.click("reset_assigned")).assigned).toBe(0);
    expect((await s.click("underfunded")).assigned).toBe(100000);
    await s.assign("W", DEC, 30000);
    expect((await preview(s.bid, DEC, `&category_ids=${s.id}`)).body.underfunded).toBe(70000);
    expect((await s.click("underfunded")).assigned).toBe(100000);
  });

  it("auto_assign applies over MCP", async () => {
    const s = await worked();
    const r = await mcp("auto_assign", {
      budget_id: s.bid,
      month: DEC,
      strategy: "spent_last_month",
      category_ids: [s.id],
      today: TODAY,
    });
    expect(r.structuredContent).toEqual({
      month: DEC,
      strategy: "spent_last_month",
      changed: [{ month: DEC, category_id: s.id, assigned: 30000 }],
    });
  });
});

describe("auto-assign: scope and history", () => {
  it("multi-select applies per category", async () => {
    const s = await seedPlan(["A", "B"]);
    await s.target("A", MONTHLY100);
    await s.target("B", MONTHLY100);
    const ids = [s.ids.A, s.ids.B] as string[];
    expect((await preview(s.bid, NOV, `&category_ids=${ids.join(",")}`)).body.underfunded).toBe(
      200000,
    );
    const res = await post(s.bid, NOV, { strategy: "underfunded", category_ids: ids });
    expect(((await res.json()) as Json).data.changed).toHaveLength(2);
    for (const id of ids) expect((await assignedOf(s.bid, NOV, id)).assigned).toBe(100000);
  });

  it("a view scopes plan-wide runs: snoozed and hidden are never changed by Underfunded", async () => {
    const s = await seedPlan(["U", "S", "H", "O"]);
    await s.target("U", { cadence: "monthly", behavior: "set_aside", amount: 60000 });
    await s.target("S", MONTHLY100);
    await s.target("H", { cadence: "monthly", behavior: "set_aside", amount: 25000 });
    await s.assign("S", NOV, 50000);
    await s.assign("H", NOV, 5000);
    await s.assign("O", NOV, 10000);
    await send(
      "PUT",
      api(s.bid, `/months/${NOV}/categories/${s.ids.S}/target-snooze?today=${TODAY}`),
      {
        snoozed: true,
      },
    );
    await send("PATCH", api(s.bid, `/categories/${s.ids.H}`), { hidden: true });
    expect((await preview(s.bid, NOV, "&view=underfunded")).body.underfunded).toBe(60000);
    const r = await post(s.bid, NOV, { strategy: "underfunded", view: "underfunded" });
    expect(((await r.json()) as Json).data.changed).toEqual([
      { month: NOV, category_id: s.ids.U, assigned: 60000 },
    ]);
    const a = (n: string) => assignedOf(s.bid, NOV, s.ids[n] as string).then((c) => c.assigned);
    expect([await a("U"), await a("S"), await a("H"), await a("O")]).toEqual([
      60000, 50000, 5000, 10000,
    ]);
    const reset = await post(s.bid, NOV, { strategy: "reset_assigned", view: "money_available" });
    const changed = ((await reset.json()) as Json).data.changed as Json[];
    expect(changed.map((c) => c.category_id).sort()).toEqual(
      [s.ids.U, s.ids.S, s.ids.O].sort() as string[],
    );
    expect([await a("U"), await a("S"), await a("H"), await a("O")]).toEqual([0, 0, 5000, 0]);
  });

  it("history: one row per changed category with the actor and one shared run id", async () => {
    const s = await seedPlan(["A", "B", "C"]);
    for (const n of ["A", "B", "C"]) await s.target(n, MONTHLY100);
    await s.assign("C", NOV, 100000);
    await post(s.bid, NOV, { strategy: "underfunded", category_ids: Object.values(s.ids) });
    const rows = (await logs(s.bid, "month_category")).filter((r) =>
      r.after_json?.includes("auto_assign"),
    );
    expect(rows).toHaveLength(2);
    const after = rows.map((r) => JSON.parse(r.after_json ?? "{}"));
    expect(new Set(after.map((a) => a.auto_assign.id)).size).toBe(1);
    expect(after[0].auto_assign.strategy).toBe("underfunded");
    expect(rows.every((r) => r.actor === actor)).toBe(true);
    expect(JSON.parse(rows[0]?.before_json ?? "{}").assigned).toBe(0);
    const before = (await logs(s.bid)).length;
    await post(s.bid, NOV, { strategy: "underfunded", category_ids: Object.values(s.ids) });
    expect((await logs(s.bid)).length).toBe(before);
  });

  it("a second run adds nothing more", async () => {
    const s = await worked();
    await Promise.all([s.click("underfunded"), s.click("underfunded")]);
    expect((await assignedOf(s.bid, DEC, s.id)).assigned).toBe(100000);
  });

  it("atomicity: a failing log entry writes no cell", async () => {
    const s = await seedPlan(["A", "B"]);
    const db = getDb(env);
    const cells = [
      { id: s.ids.A as string, before: undefined, after: 5000 },
      { id: s.ids.B as string, before: undefined, after: 7000 },
    ];
    const { stmts } = buildAutoAssignBatch(
      db,
      actor,
      { budget_id: s.bid, month: NOV, strategy: "underfunded" },
      crypto.randomUUID(),
      cells,
      new Date().toISOString(),
    );
    // A statement that always fails, last: the whole batch rolls back.
    await expect(
      db.batch([...stmts, db.run(sql`insert into no_such_table values (1)`)] as never),
    ).rejects.toThrow();
    expect((await assignedOf(s.bid, NOV, s.ids.A as string)).assigned).toBe(0);
    expect((await logs(s.bid)).filter((r) => r.after_json?.includes("auto_assign"))).toHaveLength(
      0,
    );
    // And the real run still works afterwards.
    expect(
      (
        await autoAssign(
          env,
          actor,
          { budget_id: s.bid, month: NOV, strategy: "reset_assigned" },
          TODAY,
        )
      ).changed,
    ).toEqual([]);
  });

  it("a plan-wide run over many categories stays within D1's parameter limit", async () => {
    const names = Array.from({ length: 40 }, (_, i) => `Many${i}`);
    const s = await seedPlan(names);
    for (const n of names) await s.assign(n, NOV, 10000);
    const r = await post(s.bid, NOV, {
      strategy: "reset_assigned",
      category_ids: Object.values(s.ids),
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Json).data.changed).toHaveLength(40);
    const rows = (await logs(s.bid, "month_category")).filter((l) =>
      l.after_json?.includes("auto_assign"),
    );
    expect(rows).toHaveLength(40);
    const plan = await post(s.bid, NOV, { strategy: "reset_assigned", view: "all" });
    expect(plan.status).toBe(200);
  });

  it("refuses both scopes, a bad strategy and unknown ids", async () => {
    const s = await seedPlan(["A"]);
    const both = { strategy: "underfunded", category_ids: [s.ids.A], view: "all" };
    expect((await post(s.bid, NOV, both)).status).toBe(422);
    expect((await post(s.bid, NOV, { strategy: "nope" })).status).toBe(422);
    expect(
      (await post(s.bid, NOV, { strategy: "underfunded", category_ids: [crypto.randomUUID()] }))
        .status,
    ).toBe(404);
    expect(
      (await send("GET", api(s.bid, `/months/${NOV}/auto-assign?view=all&category_ids=${s.ids.A}`)))
        .status,
    ).toBe(422);
    expect((await post(crypto.randomUUID(), NOV, { strategy: "underfunded" })).status).toBe(404);
    expect(
      (
        await mcp("auto_assign", {
          budget_id: s.bid,
          month: NOV,
          strategy: "underfunded",
          view: "all",
          category_ids: [s.ids.A],
        })
      ).isError,
    ).toBe(true);
  });

  it("is on the surface", async () => {
    const paths = await apiPaths();
    expect(paths).toContain("/api/v1/budgets/{budget_id}/months/{month}/auto-assign");
    const tools = await listedToolNames();
    expect(tools).toContain("preview_auto_assign");
    expect(tools).toContain("auto_assign");
  });
});
