import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteTarget } from "../src/services/targets";
import { actor, api, type Json, logs, mcp, send } from "./category-helpers";
import { DEC, MONTHLY100, NOV, seedPlan, TODAY } from "./plan-fixtures";
import { apiPaths, listedToolNames } from "./surface";

const url = (bid: string, month: string, cat: string, today = TODAY) =>
  api(bid, `/months/${month}/categories/${cat}/target-snooze?today=${today}`);

async function seed() {
  const s = await seedPlan(["With", "Without"]);
  await s.target("With", MONTHLY100);
  await s.assign("With", NOV, 40000);
  const state = async (month = NOV) => {
    const res = await send("GET", api(s.bid, `/months/${month}?today=${TODAY}`));
    const d = ((await res.json()) as Json).data;
    return (d.groups.flatMap((g: Json) => g.categories) as Json[]).find(
      (c) => c.name === "With",
    ) as Json;
  };
  const put = (snoozed: boolean, month = NOV, cat = s.ids.With as string, today = TODAY) =>
    send("PUT", url(s.bid, month, cat, today), { snoozed });
  return { ...s, state, put };
}

describe("target snooze", () => {
  it("round trip over REST: status, history with the actor, next month untouched", async () => {
    const s = await seed();
    expect((await s.state()).target.status).toBe("underfunded");
    const res = await s.put(true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data).toEqual({
      month: NOV,
      category_id: s.ids.With,
      snoozed: true,
    });
    const snoozed = await s.state();
    expect(snoozed.target_snoozed).toBe(true);
    expect(snoozed.target.status).toBe("snoozed");
    expect(snoozed.target.to_go_this_month).toBe(60000);
    expect((await s.state(DEC)).target_snoozed).toBe(false);
    expect((await s.state(DEC)).target.status).toBe("underfunded");
    const l = await logs(s.bid, "target_snooze");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ actor, action: "update", entity_id: `${s.ids.With}:${NOV}` });
    expect(JSON.parse(l[0]?.after_json ?? "{}")).toMatchObject({ snoozed: true });
    expect((await s.put(false)).status).toBe(200);
    expect((await s.state()).target_snoozed).toBe(false);
    expect(await logs(s.bid, "target_snooze")).toHaveLength(2);
  });

  it("asking for the state it already has writes nothing", async () => {
    const s = await seed();
    await s.put(false);
    await s.put(true);
    await s.put(true);
    expect(await logs(s.bid, "target_snooze")).toHaveLength(1);
    const { results } = await env.DB.prepare(
      "select count(*) as n from target_snoozes where budget_id = ?",
    )
      .bind(s.bid)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("the tool snoozes and refuses like the route", async () => {
    const s = await seed();
    const ok = await mcp("snooze_target", {
      budget_id: s.bid,
      month: NOV,
      category_id: s.ids.With,
      snoozed: true,
      today: TODAY,
    });
    expect(ok.structuredContent).toEqual({ month: NOV, category_id: s.ids.With, snoozed: true });
    const other = await mcp("snooze_target", {
      budget_id: s.bid,
      month: DEC,
      category_id: s.ids.With,
      snoozed: true,
      today: TODAY,
    });
    expect(other.isError).toBe(true);
    const none = await mcp("snooze_target", {
      budget_id: s.bid,
      month: NOV,
      category_id: s.ids.Without,
      snoozed: true,
      today: TODAY,
    });
    expect(none.isError).toBe(true);
  });

  it("422 and nothing stored for another month or a category without a target", async () => {
    const s = await seed();
    const next = await s.put(true, DEC);
    expect(next.status).toBe(422);
    expect(((await next.json()) as Json).error.detail).toBe(
      "You can only snooze targets in the current month.",
    );
    const none = await s.put(true, NOV, s.ids.Without);
    expect(none.status).toBe(422);
    expect(((await none.json()) as Json).error.detail).toBe(
      "This category has no target to snooze.",
    );
    expect((await s.state()).target_snoozed).toBe(false);
    expect(await logs(s.bid, "target_snooze")).toHaveLength(0);
  });

  it("the current month comes from today: last day and first day of the next month", async () => {
    const s = await seed();
    expect((await s.put(true, NOV, s.ids.With, "2026-11-30")).status).toBe(200);
    expect((await s.put(true, NOV, s.ids.With, "2026-12-01")).status).toBe(422);
    expect((await s.put(true, DEC, s.ids.With, "2026-12-01")).status).toBe(200);
    expect((await s.put(true, NOV, s.ids.With, "2026-11-31")).status).toBe(422);
  });

  it("unknown plan or category is 404", async () => {
    const s = await seed();
    expect((await s.put(true, NOV, crypto.randomUUID())).status).toBe(404);
    expect(
      (await send("PUT", url(crypto.randomUUID(), NOV, s.ids.With as string), { snoozed: true }))
        .status,
    ).toBe(404);
  });

  it("deleting the target removes its snoozes, so a new target is not snoozed", async () => {
    const s = await seed();
    await s.put(true);
    await deleteTarget(env, actor, { budget_id: s.bid, category_id: s.ids.With as string });
    await s.target("With", MONTHLY100);
    expect((await s.state()).target_snoozed).toBe(false);
    expect((await s.state()).target.status).toBe("underfunded");
  });

  it("two concurrent identical requests log one change", async () => {
    const s = await seed();
    await Promise.all([s.put(true), s.put(true)]);
    expect(await logs(s.bid, "target_snooze")).toHaveLength(1);
  });

  it("a snooze racing a target delete leaves no snooze behind", async () => {
    const s = await seed();
    await Promise.all([
      s.put(true),
      deleteTarget(env, actor, { budget_id: s.bid, category_id: s.ids.With as string }),
    ]);
    await s.target("With", MONTHLY100);
    expect((await s.state()).target_snoozed).toBe(false);
  });

  it("is on the surface", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/target-snooze",
    );
    expect(await listedToolNames()).toContain("snooze_target");
  });
});
