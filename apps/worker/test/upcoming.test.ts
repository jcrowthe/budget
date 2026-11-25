import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { account as openAccount } from "./account-helpers";
import { actor, api, type Json, mcp, send } from "./category-helpers";
import { DEC, NOV, seedPlan, TODAY } from "./plan-fixtures";
import { S, sched } from "./scheduled-helpers";
import { apiPaths, listedToolNames } from "./surface";

// EXF-505: upcoming. Weekly -20.00 from 2026-11-22, created with today = 2026-11-15, on "ZZ-TEST Fun" with
// 50.00 assigned in November and 20.00 spent on 11/10: Available 30.00, upcoming -40.00 in November.
const get = async (bid: string, path: string) => {
  const res = await send("GET", api(bid, path));
  return { status: res.status, body: ((await res.json()) as Json).data as Json, res };
};
const catRead = (bid: string, id: string, month = NOV) =>
  get(bid, `/months/${month}/categories/${id}`);
const monthCat = async (bid: string, id: string, month = NOV) => {
  const m = (await get(bid, `/months/${month}?today=${TODAY}`)).body;
  return {
    m,
    c: m.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.id === id) as Json,
  };
};

async function world() {
  const s = await seedPlan(["ZZ-TEST Fun"]);
  const fun = s.ids["ZZ-TEST Fun"] as string;
  const checking = (await openAccount(s.bid, "checking", 0, "ZZ-TEST Checking")).id as string;
  await s.assign("ZZ-TEST Fun", NOV, 50000);
  await s.spend("ZZ-TEST Fun", "2026-11-10", 20000);
  const weekly = (
    await sched(s.bid, {
      account_id: checking,
      date_first: "2026-11-22",
      frequency: "weekly",
      amount: -20000,
      category_id: fun,
      payee_name: "ZZ-TEST Gym",
      memo: "ZZ-TEST memo",
    })
  ).scheduled_transaction;
  return { ...s, fun, checking, weekly };
}

describe("upcoming: the month-category read (AC1, AC7)", () => {
  it("has upcoming, count and available after upcoming; the month read agrees", async () => {
    const w = await world();
    const want = {
      upcoming: -40000,
      upcoming_count: 2,
      available: 30000,
      available_after_upcoming: -10000,
    };
    const one = (await catRead(w.bid, w.fun)).body;
    expect(one).toMatchObject(want);
    const { c } = await monthCat(w.bid, w.fun);
    expect(c).toMatchObject(want);
  });

  it("AC2: Assigned 60.00 brings Available After Upcoming to zero", async () => {
    const w = await world();
    const res = await send("PATCH", api(w.bid, `/months/${NOV}/categories/${w.fun}`), {
      assigned: 60000,
    });
    expect(res.status).toBe(200);
    expect((await catRead(w.bid, w.fun)).body).toMatchObject({
      upcoming: -40000,
      available_after_upcoming: 0,
    });
  });

  it("AC4: December has four occurrences, November's are not carried", async () => {
    const w = await world();
    expect((await catRead(w.bid, w.fun, DEC)).body).toMatchObject({
      upcoming: -80000,
      upcoming_count: 4,
    });
    const list = (await get(w.bid, `/months/${DEC}/categories/${w.fun}/upcoming`)).body;
    expect(list.occurrences.map((o: Json) => o.date)).toEqual([
      "2026-12-27",
      "2026-12-20",
      "2026-12-13",
      "2026-12-06",
    ]);
  });

  it("a month before the schedule starts has nothing", async () => {
    const w = await world();
    expect((await catRead(w.bid, w.fun, "2026-10-01")).body).toMatchObject({
      upcoming: 0,
      upcoming_count: 0,
    });
  });
});

describe("upcoming: the list (AC3)", () => {
  it("lists the occurrences latest first with their schedule's fields", async () => {
    const w = await world();
    const r = await get(w.bid, `/months/${NOV}/categories/${w.fun}/upcoming`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      category_id: w.fun,
      month: NOV,
      upcoming: -40000,
      upcoming_count: 2,
      available: 30000,
      available_after_upcoming: -10000,
    });
    expect(r.body.occurrences.map((o: Json) => o.date)).toEqual(["2026-11-29", "2026-11-22"]);
    expect(r.body.occurrences[0]).toEqual({
      scheduled_transaction_id: w.weekly.id,
      account_id: w.checking,
      account_name: "ZZ-TEST Checking",
      date: "2026-11-29",
      payee_id: expect.any(String),
      payee_name: "ZZ-TEST Gym",
      memo: "ZZ-TEST memo",
      amount: -20000,
    });
  });
});

describe("upcoming: Auto-Assign Underfunded (AC5)", () => {
  const under = async (bid: string, id: string) =>
    (await get(bid, `/months/${NOV}/auto-assign?today=${TODAY}&category_ids=${id}`)).body
      .underfunded as number;

  it("adds the shortfall, and drops to zero once covered", async () => {
    const w = await world();
    expect(await under(w.bid, w.fun)).toBe(10000);
    await send("PATCH", api(w.bid, `/months/${NOV}/categories/${w.fun}`), { assigned: 60000 });
    expect(await under(w.bid, w.fun)).toBe(0);
  });

  it("takes the larger of the target's to-go and the shortfall", async () => {
    const w = await world();
    await w.target("ZZ-TEST Fun", { cadence: "monthly", behavior: "set_aside", amount: 100000 });
    const { c } = await monthCat(w.bid, w.fun);
    const toGo = c.target.to_go_this_month as number;
    expect(toGo).toBeGreaterThan(10000);
    expect(await under(w.bid, w.fun)).toBe(toGo);
  });

  it("the Underfunded button applies the shortfall to Assigned", async () => {
    const w = await world();
    const res = await send("POST", api(w.bid, `/months/${NOV}/auto-assign?today=${TODAY}`), {
      strategy: "underfunded",
      category_ids: [w.fun],
    });
    expect(res.status).toBe(200);
    expect((await catRead(w.bid, w.fun)).body.available_after_upcoming).toBe(0);
  });
});

describe("upcoming: Ready to Assign and the rules of what counts (AC6, R2)", () => {
  it("AC6: an inflow to Ready to Assign leaves it unchanged and every category at zero", async () => {
    const w = await world();
    const before = (await get(w.bid, `/months/${NOV}?today=${TODAY}`)).body.ready_to_assign;
    await sched(w.bid, {
      account_id: w.checking,
      date_first: "2026-11-20",
      frequency: "never",
      amount: 500000,
      inflow_to_ready_to_assign: true,
      payee_name: "ZZ-TEST Pay",
    });
    const m = (await get(w.bid, `/months/${NOV}?today=${TODAY}`)).body;
    expect(m.ready_to_assign).toBe(before);
    for (const c of m.groups.flatMap((g: Json) => g.categories)) {
      expect(c.upcoming_count, c.name).toBe(0);
      expect(c.upcoming, c.name).toBe(0);
    }
  });

  it("counts nothing for a deleted schedule, a closed or tracking account, or a deleted category", async () => {
    const w = await world();
    const q = (sql: string, ...b: unknown[]) =>
      env.DB.prepare(sql)
        .bind(...b)
        .run();
    // Remove the weekly schedule through REST, then add one schedule per rule by SQL.
    expect((await send("DELETE", `${S(w.bid)}/${w.weekly.id}`)).status).toBe(200);
    const closed = (await openAccount(w.bid, "checking", 0, "ZZ-TEST Closed")).id as string;
    const tracking = (await openAccount(w.bid, "otherAsset", 0, "ZZ-TEST Tracking")).id as string;
    const g = await createCategoryGroup(env, actor, { budget_id: w.bid, name: "ZZ-TEST G2" });
    const gone = (
      await createCategory(env, actor, { budget_id: w.bid, group_id: g.id, name: "ZZ-TEST Gone" })
    ).id;
    const ins = (acc: string, cat: string) => {
      const now = new Date().toISOString();
      return q(
        "insert into scheduled_transactions (id, budget_id, account_id, category_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, '2026-11-20', '2026-11-20', 'never', -5000, 0, ?, ?, ?)",
        crypto.randomUUID(),
        w.bid,
        acc,
        cat,
        crypto.randomUUID(),
        now,
        now,
      );
    };
    await ins(closed, w.fun);
    await q("update accounts set closed = 1 where id = ?", closed);
    await ins(tracking, w.fun);
    await ins(w.checking, gone);
    await q("update categories set deleted_at = ? where id = ?", new Date().toISOString(), gone);
    const { c } = await monthCat(w.bid, w.fun);
    expect(c).toMatchObject({ upcoming: 0, upcoming_count: 0, available_after_upcoming: 30000 });
  });
});

describe("upcoming: errors and surface", () => {
  it("404 for an unknown plan or category, 422 for a bad month", async () => {
    const w = await world();
    const ghost = crypto.randomUUID();
    expect(
      (await send("GET", api(ghost, `/months/${NOV}/categories/${w.fun}/upcoming`))).status,
    ).toBe(404);
    expect(
      (await send("GET", api(w.bid, `/months/${NOV}/categories/${ghost}/upcoming`))).status,
    ).toBe(404);
    expect(
      (await send("GET", api(w.bid, `/months/2026-11-05/categories/${w.fun}/upcoming`))).status,
    ).toBe(422);
  });

  it("is in the OpenAPI document and the MCP tool list", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/upcoming",
      ]),
    );
    expect(await listedToolNames()).toContain("list_upcoming_for_category");
  });
});

describe("upcoming: REST and MCP agree (Acceptance 2)", () => {
  it("get_month_category, get_plan_month and list_upcoming_for_category equal the REST data", async () => {
    const w = await world();
    const args = { budget_id: w.bid, month: NOV, category_id: w.fun };
    const one = await mcp("get_month_category", args);
    expect(one.structuredContent).toEqual((await catRead(w.bid, w.fun)).body);
    const pm = await mcp("get_plan_month", { budget_id: w.bid, month: NOV, today: TODAY });
    expect(pm.structuredContent).toEqual((await get(w.bid, `/months/${NOV}?today=${TODAY}`)).body);
    const list = await mcp("list_upcoming_for_category", args);
    expect(list.structuredContent).toEqual(
      (await get(w.bid, `/months/${NOV}/categories/${w.fun}/upcoming`)).body,
    );
    expect(list.structuredContent.upcoming_count).toBe(2);
  });
});
