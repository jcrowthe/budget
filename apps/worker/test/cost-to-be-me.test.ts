import { env } from "cloudflare:test";
import { ceilCent } from "@budget/core/targets";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { setExpectedIncome } from "../src/services/budgets";
import { getMonthSummary, getPlanMonth, setAssigned } from "../src/services/months";
import { deleteTarget, setTarget, setTargetSnooze } from "../src/services/targets";
import { actor, api, cat, type Json, logs, mcp, month, plan, send } from "./category-helpers";
import { listedToolNames } from "./surface";

// EXF-525: Cost to Be Me. targets_total and next_month_targets_total on the month summary, and the plan's
// expected_income. Milliunits; today is 2026-11-15 (November 2026 has 4 Saturdays and 4 Tuesdays, December
// 2026 has 4 Saturdays and 5 Tuesdays).

const TODAY = "2026-11-15";
const NOV = "2026-11-01";
const DEC = "2026-12-01";

async function seed() {
  const bid = await plan();
  const m = await month(bid, NOV);
  const c = (name: string) => cat(m, name).id;
  const ids = {
    monthly: c("🛒 Groceries"),
    weekly: c("🏠 Rent/Mortgage"),
    yearly: c("🍿 Entertainment"),
  };
  const all = m.groups.flatMap((g) => g.categories.map((x) => x.id));
  const spare = all.filter((id) => !Object.values(ids).includes(id));
  const put = (
    category_id: string,
    t: Record<string, unknown>,
    today = TODAY,
  ): ReturnType<typeof setTarget> =>
    setTarget(env, actor, { budget_id: bid, category_id, ...t } as never, { today });
  const total = async (at = NOV, today = TODAY) => {
    const s = await getMonthSummary(env, bid, at, undefined, today);
    return { total: s.targets_total, next: s.next_month_targets_total };
  };
  return { bid, m, ids, spare, put, total };
}

describe("targets_total per target kind", () => {
  it("monthly: the amount, edited, then deleted", async () => {
    const s = await seed();
    expect((await s.total()).total).toBe(0);
    await s.put(s.ids.monthly, { cadence: "monthly", behavior: "set_aside", amount: 10000 });
    expect((await s.total()).total).toBe(10000);
    await s.put(s.ids.monthly, { cadence: "monthly", behavior: "set_aside", amount: 25000 });
    expect((await s.total()).total).toBe(25000);
    await deleteTarget(env, actor, { budget_id: s.bid, category_id: s.ids.monthly });
    expect((await s.total()).total).toBe(0);
  });

  it("weekly: amount times the Saturdays of the month, even when created mid-month", async () => {
    const s = await seed();
    await s.put(s.ids.weekly, {
      cadence: "weekly",
      behavior: "set_aside",
      amount: 10000,
      day_of_week: 6,
    });
    expect((await s.total()).total).toBe(40000);
    // The engine still needs only the weeks left; the total is flat.
    const detail = await getPlanMonth(env, s.bid, NOV, TODAY);
    const c = detail.groups.flatMap((g) => g.categories).find((x) => x.id === s.ids.weekly);
    expect(c?.target?.needed_this_month).toBe(20000);
  });

  it("yearly: the amount over twelve months", async () => {
    const s = await seed();
    await s.put(s.ids.yearly, {
      cadence: "yearly",
      behavior: "set_aside",
      amount: 120000,
      due_date: "2027-10-31",
    });
    expect((await s.total()).total).toBe(10000);
  });

  it("custom balance: spread to its date, and 0 with no date", async () => {
    const s = await seed();
    await s.put(s.ids.monthly, {
      cadence: "custom",
      behavior: "balance",
      amount: 60000,
      due_month: "2027-04-01",
    });
    expect((await s.total()).total).toBe(10000);
    await s.put(s.ids.monthly, { cadence: "custom", behavior: "balance", amount: 60000 });
    expect((await s.total()).total).toBe(0);
  });

  it("snoozed targets still count", async () => {
    const s = await seed();
    await s.put(s.ids.monthly, { cadence: "monthly", behavior: "set_aside", amount: 10000 });
    await setTargetSnooze(
      env,
      actor,
      { budget_id: s.bid, month: NOV, category_id: s.ids.monthly, snoozed: true },
      { today: TODAY },
    );
    expect((await s.total()).total).toBe(10000);
  });

  it("is the flat amount, not what is still needed", async () => {
    const s = await seed();
    await s.put(s.ids.monthly, { cadence: "monthly", behavior: "set_aside", amount: 10000 });
    await s.put(s.ids.yearly, {
      cadence: "custom",
      behavior: "balance",
      amount: 60000,
      due_month: "2027-04-01",
    });
    await setAssigned(env, actor, {
      budget_id: s.bid,
      month: NOV,
      category_id: s.ids.monthly,
      assigned: 10000,
    });
    await setAssigned(env, actor, {
      budget_id: s.bid,
      month: "2026-10-01",
      category_id: s.ids.yearly,
      assigned: 5000,
    });
    expect((await s.total()).total).toBe(20000);
  });
});

describe("targets_total scope", () => {
  it("ignores hidden categories and hidden groups; view and category_ids never change it", async () => {
    const s = await seed();
    await s.put(s.ids.monthly, { cadence: "monthly", behavior: "set_aside", amount: 10000 });
    await s.put(s.ids.yearly, { cadence: "monthly", behavior: "set_aside", amount: 7000 });
    await s.put(s.ids.weekly, { cadence: "monthly", behavior: "set_aside", amount: 3000 });
    expect((await s.total()).total).toBe(20000);
    const a = await getMonthSummary(env, s.bid, NOV, [s.ids.monthly], TODAY);
    expect(a.targets_total).toBe(20000);
    const b = await getMonthSummary(env, s.bid, NOV, undefined, TODAY, "underfunded");
    expect(b.targets_total).toBe(20000);
    await send("PATCH", api(s.bid, `/categories/${s.ids.yearly}`), { hidden: true });
    expect((await s.total()).total).toBe(13000);
    const group = s.m.groups.find((g) => g.categories.some((c) => c.id === s.ids.weekly));
    await send("PATCH", api(s.bid, `/category_groups/${group?.id}`), { hidden: true });
    const left = s.m.groups
      .filter((g) => g.id !== group?.id)
      .some((g) => g.categories.some((c) => c.id === s.ids.monthly));
    expect((await s.total()).total).toBe(left ? 10000 : 0);
  });
});

describe("next_month_targets_total", () => {
  it("counts next month's Saturdays and Tuesdays", async () => {
    const s = await seed();
    await s.put(s.ids.weekly, {
      cadence: "weekly",
      behavior: "set_aside",
      amount: 10000,
      day_of_week: 6,
    });
    expect(await s.total()).toEqual({ total: 40000, next: 40000 });
    await s.put(s.ids.weekly, {
      cadence: "weekly",
      behavior: "set_aside",
      amount: 10000,
      day_of_week: 2,
    });
    const t = await s.total();
    expect(t).toEqual({ total: 40000, next: 50000 });
    expect(t.next).toBeGreaterThan(t.total);
  });

  it("custom balance spreads over one month less; a one-off due this month adds 0", async () => {
    const s = await seed();
    await s.put(s.ids.monthly, {
      cadence: "custom",
      behavior: "balance",
      amount: 60000,
      due_month: "2027-04-01",
    });
    expect((await s.total()).next).toBe(ceilCent(60000, 5));
    await s.put(s.ids.monthly, {
      cadence: "custom",
      behavior: "set_aside",
      amount: 30000,
      due_date: "2026-11-28",
    });
    expect(await s.total()).toEqual({ total: 30000, next: 0 });
  });

  it("a target created in December adds 0 to November and its amount to next month", async () => {
    const s = await seed();
    await s.put(
      s.ids.monthly,
      { cadence: "monthly", behavior: "set_aside", amount: 10000 },
      "2026-12-02",
    );
    expect(await s.total(NOV, "2026-12-02")).toEqual({ total: 0, next: 10000 });
  });
});

describe("card payoff", () => {
  it("equals the payment category's engine figure, this month and next", async () => {
    const bid = await plan();
    const open = async (name: string, type: string, balance: number) => {
      const res = await send("POST", api(bid, "/accounts"), {
        name,
        type,
        balance,
        date: "2026-11-02",
      });
      expect(res.status).toBe(201);
    };
    await open("ZZ-TEST Checking", "checking", 1000000);
    await open("ZZ-TEST Card", "creditCard", 1200000);
    const detail = await getPlanMonth(env, bid, NOV, TODAY);
    const pay = detail.groups
      .flatMap((g) => g.categories)
      .find((c) => c.kind === "credit_card_payment");
    expect(pay).toBeDefined();
    const put = await send("PUT", api(bid, `/categories/${pay?.id}/target?today=${TODAY}`), {
      type: "card_payoff_by_date",
      month: "2027-04-01",
    });
    expect(put.status).toBe(200);
    const figure = async (at: string) =>
      (await getPlanMonth(env, bid, at, TODAY)).groups
        .flatMap((g) => g.categories)
        .find((c) => c.id === pay?.id)?.target?.amount_this_month;
    const s = await getMonthSummary(env, bid, NOV, undefined, TODAY);
    expect(await figure(NOV)).toBeGreaterThan(0);
    expect(s.targets_total).toBe(await figure(NOV));
    expect(s.next_month_targets_total).toBe(await figure(DEC));
  });
});

describe("REST = MCP", () => {
  it("get_month_summary returns the same two fields as the REST summary", async () => {
    const s = await seed();
    await s.put(s.ids.weekly, {
      cadence: "weekly",
      behavior: "set_aside",
      amount: 10000,
      day_of_week: 2,
    });
    const res = await send("GET", api(s.bid, `/months/${NOV}/summary?today=${TODAY}`));
    const rest = ((await res.json()) as Json).data;
    expect(rest.targets_total).toBe(40000);
    expect(rest.next_month_targets_total).toBe(50000);
    const tool = await mcp("get_month_summary", { budget_id: s.bid, month: NOV, today: TODAY });
    expect(tool.structuredContent).toEqual(rest);
  });
});

describe("expected_income", () => {
  const patch = (id: string, body: unknown) => send("PATCH", `/api/v1/budgets/${id}`, body);
  const read = async (id: string) =>
    ((await (await send("GET", `/api/v1/budgets/${id}`)).json()) as Json).data.budget as Json;

  it("sets, reads, lists and clears it", async () => {
    const bid = await plan();
    expect((await read(bid)).expected_income).toBeNull();
    const set = await patch(bid, { expected_income: 500000 });
    expect(set.status).toBe(200);
    expect(((await set.json()) as Json).data.budget.expected_income).toBe(500000);
    expect((await read(bid)).expected_income).toBe(500000);
    const list = ((await (await send("GET", "/api/v1/budgets")).json()) as Json).data.budgets;
    expect(list.find((b: Json) => b.id === bid).expected_income).toBe(500000);
    const zero = await patch(bid, { expected_income: 0 });
    expect(((await zero.json()) as Json).data.budget.expected_income).toBeNull();
    await patch(bid, { expected_income: 500000 });
    const cleared = await patch(bid, { expected_income: null });
    expect(((await cleared.json()) as Json).data.budget.expected_income).toBeNull();
    expect((await read(bid)).expected_income).toBeNull();
  });

  it("refuses a negative with 422 and writes nothing", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    const res = await patch(bid, { expected_income: -1 });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { name: "negative_expected_income" } });
    expect((await read(bid)).expected_income).toBeNull();
    expect((await logs(bid, "budget")).length).toBe(before);
  });

  it("logs one change_log row per write, with the actor and the value", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    await patch(bid, { expected_income: 500000 });
    const rows = await logs(bid, "budget");
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1] as NonNullable<(typeof rows)[number]>;
    expect(last.entity_type).toBe("budget");
    expect(last.actor).toBe(actor);
    expect(JSON.parse(last.before_json ?? "{}").expected_income).toBeNull();
    expect(JSON.parse(last.after_json ?? "{}").expected_income).toBe(500000);
  });

  it("MCP set_expected_income gives the REST budget, logs the mcp actor, refuses a negative", async () => {
    const bid = await plan();
    const r = await mcp("set_expected_income", { budget_id: bid, expected_income: 750000 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.budget).toEqual(await read(bid));
    expect(r.structuredContent.budget.expected_income).toBe(750000);
    const rows = await logs(bid, "budget");
    expect(rows.at(-1)?.actor).toMatch(/^mcp:/);
    const bad = await mcp("set_expected_income", { budget_id: bid, expected_income: -5 });
    expect(bad.isError).toBe(true);
    expect((await read(bid)).expected_income).toBe(750000);
  });

  it("is one db.batch", async () => {
    const bid = await plan();
    let batches = 0;
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch") {
          return (list: D1PreparedStatement[]) => {
            batches += 1;
            return t.batch(list);
          };
        }
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    const b = await setExpectedIncome({ ...env, DB: db } as Env, actor, bid, 500000);
    expect(b.expected_income).toBe(500000);
    expect(batches).toBe(1);
  });

  it("lists set_expected_income among the tools", async () => {
    expect(await listedToolNames()).toEqual(expect.arrayContaining(["set_expected_income"]));
  });
});
