import { env } from "cloudflare:test";
import {
  REPEAT_UNITS,
  TARGET_BEHAVIORS,
  TARGET_CADENCES,
  TARGET_STATUSES,
} from "@budget/core/targets";
import { MonthDetailResponse } from "@budget/schema/months";
import {
  RepeatUnit,
  TargetBehavior,
  TargetCadence,
  type TargetSet as TargetSetInput,
  TargetStatus,
} from "@budget/schema/targets";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "../src/db/client";
import { NotFound } from "../src/middleware/errors";
import { createAccount } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { getPlanMonth, setAssigned } from "../src/services/months";
import {
  buildSetTargetBatch,
  deleteTarget,
  setTarget,
  targetToApi,
  todayUtc,
} from "../src/services/targets";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";

const actor = "user:tester@localhost";
const TODAY = "2026-11-15";
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const JAN = "2027-01-01";

const DEFS: Record<string, Omit<TargetSetInput, "budget_id" | "category_id">> = {
  Monthly: { cadence: "monthly", behavior: "set_aside", amount: 100000 },
  Refill: { cadence: "monthly", behavior: "refill", amount: 100000 },
  Yearly: { cadence: "yearly", behavior: "set_aside", amount: 1200000, due_date: "2027-10-31" },
  YearlyBare: { cadence: "yearly", behavior: "set_aside", amount: 1200000, due_date: "2027-10-31" },
  Balance: { cadence: "custom", behavior: "balance", amount: 600000, due_month: "2027-04-01" },
  BalanceBare: { cadence: "custom", behavior: "balance", amount: 600000, due_month: "2027-04-01" },
  Plain: { cadence: "monthly", behavior: "set_aside", amount: 1000 },
};

async function seed() {
  const budget = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const bid = budget.id;
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  const group = await createCategoryGroup(env, actor, { budget_id: bid, name: "Bills" });
  const cats: Record<string, string> = {};
  for (const name of Object.keys(DEFS)) {
    cats[name] = (
      await createCategory(env, actor, { budget_id: bid, group_id: group.id, name })
    ).id;
    if (name !== "Plain") {
      await setTarget(
        env,
        actor,
        { ...DEFS[name], budget_id: bid, category_id: cats[name] } as TargetSetInput,
        { today: TODAY },
      );
    }
  }
  const assign = (name: string, month: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month, category_id: cats[name] as string, assigned });
  const spend = (name: string, date: string, amount: number) =>
    createTransaction(env, actor, {
      budget_id: bid,
      account_id: account.id,
      date,
      amount,
      category_id: cats[name] as string,
      inflow_to_ready_to_assign: false,
    });
  const read = async (name: string, month: string) => {
    const d = await getPlanMonth(env, bid, month, TODAY);
    const c = d.groups.flatMap((g) => g.categories).find((x) => x.name === name);
    if (!c) throw new Error(`no ${name}`);
    return c;
  };
  const target = async (name: string, month: string) => {
    const t = (await read(name, month)).target;
    if (!t) throw new Error("no target");
    return t;
  };
  return { bid, cats, assign, spend, read, target };
}

describe("targets through the services and the month read model", () => {
  it("example 1: monthly set aside", async () => {
    const s = await seed();
    await s.assign("Monthly", NOV, 40000);
    expect(await s.target("Monthly", NOV)).toMatchObject({
      needed_this_month: 100000,
      to_go_this_month: 60000,
      percent: 40,
      status: "underfunded",
    });
    await s.assign("Monthly", NOV, 100000);
    expect((await s.target("Monthly", NOV)).status).toBe("funded");
    await s.assign("Monthly", NOV, 150000);
    expect(await s.target("Monthly", NOV)).toMatchObject({ status: "funded", overfunded: 50000 });
    await s.assign("Monthly", NOV, 100000);
    await s.spend("Monthly", "2026-11-10", -30000);
    const nov = await s.read("Monthly", NOV);
    expect(nov.available).toBe(70000);
    expect(nov.target?.status).toBe("funded");
    const dec = await s.read("Monthly", DEC);
    expect(dec.carried).toBe(70000);
    expect(dec.target).toMatchObject({ needed_this_month: 100000, to_go_this_month: 100000 });
    await s.assign("Monthly", DEC, 30000);
    expect((await s.target("Monthly", DEC)).to_go_this_month).toBe(70000);
  });

  it("example 3: monthly refill", async () => {
    const s = await seed();
    await s.assign("Refill", OCT, 50000);
    await s.assign("Refill", NOV, 50000);
    expect(await s.target("Refill", NOV)).toMatchObject({
      funded: 100000,
      to_go_this_month: 0,
      status: "funded",
    });
    await s.assign("Refill", NOV, 100000);
    expect(await s.target("Refill", NOV)).toMatchObject({ funded: 150000, overfunded: 50000 });
    await s.spend("Refill", "2026-11-10", -80000);
    expect(await s.target("Refill", DEC)).toMatchObject({
      needed_this_month: 100000,
      funded: 0,
      to_go_this_month: 100000,
    });
    await s.assign("Refill", DEC, 30000);
    const dec = await s.read("Refill", DEC);
    expect(dec.available).toBe(100000);
    expect(dec.target).toMatchObject({ funded: 30000, to_go_this_month: 70000 });
    expect((await s.target("Refill", JAN)).to_go_this_month).toBe(100000);
  });

  it("example 5: yearly", async () => {
    const s = await seed();
    expect((await s.target("Yearly", NOV)).needed_this_month).toBe(100000);
    await s.assign("Yearly", NOV, 100000);
    expect(await s.target("Yearly", NOV)).toMatchObject({ percent: 8, status: "on_track" });
    expect((await s.target("Yearly", DEC)).needed_this_month).toBe(100000);
    expect((await s.target("Yearly", JAN)).needed_this_month).toBe(110000);
    expect((await s.target("YearlyBare", JAN)).needed_this_month).toBe(120000);
  });

  it("example 6: custom balance by a month", async () => {
    const s = await seed();
    expect((await s.target("Balance", NOV)).needed_this_month).toBe(100000);
    await s.spend("Balance", "2026-11-10", -20000);
    await s.assign("Balance", NOV, 150000);
    expect(await s.target("Balance", NOV)).toMatchObject({
      funded: 130000,
      needed_this_month: 103340,
      overfunded: 46660,
      percent: 21,
    });
    await s.assign("Balance", NOV, 100000);
    expect((await s.target("Balance", NOV)).to_go_this_month).toBe(3340);
    await s.assign("Balance", NOV, 103330);
    expect((await s.target("Balance", NOV)).to_go_this_month).toBe(10);
    await s.assign("Balance", NOV, 103340);
    expect((await s.target("Balance", NOV)).status).toBe("on_track");
    expect((await s.target("Balance", DEC)).needed_this_month).toBe(103340);
    expect((await s.target("Balance", JAN)).needed_this_month).toBe(129170);
    expect((await s.target("BalanceBare", JAN)).needed_this_month).toBe(150000);
  });

  it("returns null without a target, with safe integers, and REST = MCP = service", async () => {
    const s = await seed();
    await s.assign("Monthly", DEC, 1000);
    const res = await json(`/api/v1/budgets/${s.bid}/months/${DEC}`);
    expect(res.status).toBe(200);
    const rest = MonthDetailResponse.parse(await res.json()).data;
    const { tools } = await import("../src/mcp/tools/months");
    const viaMcp = await tools[0]?.run({ budget_id: s.bid, month: DEC } as never, { env, actor });
    expect(viaMcp).toEqual(rest);
    expect(rest).toEqual(await getPlanMonth(env, s.bid, DEC, todayUtc()));
    const cats = rest.groups.flatMap((g) => g.categories);
    expect(cats.find((c) => c.name === "Plain")?.target).toBeNull();
    for (const c of cats) {
      for (const [k, v] of Object.entries(c.target ?? {})) {
        if (typeof v === "number" && k !== "percent") expect(Number.isSafeInteger(v)).toBe(true);
      }
    }
  });
});

describe("history and atomicity", () => {
  it("writes create, update and delete rows in the same batch as the change", async () => {
    const s = await seed();
    const cid = s.cats.Plain as string;
    const input = { budget_id: s.bid, category_id: cid, ...DEFS.Plain } as TargetSetInput;
    const created = await setTarget(env, actor, input, { today: "2026-11-02" });
    const updated = await setTarget(
      env,
      "mcp:x",
      { ...input, amount: 2000 },
      { today: "2026-12-20" },
    );
    expect(updated.created_on).toBe(created.created_on);
    await deleteTarget(env, "mcp:y", { budget_id: s.bid, category_id: cid });
    const { results } = await env.DB.prepare(
      "SELECT actor, action, before_json, after_json, budget_id FROM change_log WHERE entity_type = 'target' AND entity_id = ? ORDER BY created_at, rowid",
    )
      .bind(cid)
      .all<{
        actor: string;
        action: string;
        before_json: string | null;
        after_json: string | null;
        budget_id: string;
      }>();
    expect(results.map((r) => [r.actor, r.action])).toEqual([
      [actor, "create"],
      ["mcp:x", "update"],
      ["mcp:y", "delete"],
    ]);
    expect(results.every((r) => r.budget_id === s.bid)).toBe(true);
    expect(results[0]?.before_json).toBeNull();
    expect(JSON.parse(results[0]?.after_json as string).amount).toBe(1000);
    expect(JSON.parse(results[1]?.before_json as string).amount).toBe(1000);
    expect(JSON.parse(results[2]?.before_json as string).amount).toBe(2000);
    expect(results[2]?.after_json).toBeNull();
    expect((await s.read("Plain", NOV)).target).toBeNull();
  });

  it("a bad change_log entry leaves no target row", async () => {
    const s = await seed();
    const cid = s.cats.Plain as string;
    const db = getDb(env);
    const row = {
      categoryId: cid,
      budgetId: s.bid,
      cadence: "monthly" as const,
      behavior: "set_aside" as const,
      amount: 1000,
      dayOfWeek: null,
      dayOfMonth: null,
      dueDate: null,
      dueMonth: null,
      repeatEvery: null,
      repeatUnit: null,
      createdOn: TODAY,
      createdAt: "x",
      updatedAt: "x",
    };
    await expect(
      db.batch([
        ...buildSetTargetBatch(
          db,
          row,
          {
            budgetId: s.bid,
            actor,
            action: "bogus" as never,
            entityType: "target",
            entityId: cid,
            before: null,
            after: targetToApi(row),
          },
          undefined,
        ),
      ]),
    ).rejects.toThrow();
    const n = await env.DB.prepare("SELECT count(*) AS n FROM targets WHERE category_id = ?")
      .bind(cid)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("validation", () => {
  it("rejects bad input and unknown rows", async () => {
    const s = await seed();
    const cid = s.cats.Plain as string;
    const b = { budget_id: s.bid, category_id: cid };
    const bad = (o: object) => setTarget(env, actor, { ...b, ...o } as TargetSetInput);
    await expect(
      bad({ cadence: "weekly", behavior: "fill_up", amount: 1000, day_of_week: 1 }),
    ).rejects.toThrow(ZodError);
    await expect(bad({ cadence: "yearly", behavior: "set_aside", amount: 1000 })).rejects.toThrow(
      ZodError,
    );
    await expect(
      bad({ cadence: "custom", behavior: "balance", amount: 1000, due_date: "2027-01-01" }),
    ).rejects.toThrow(ZodError);
    await expect(bad({ cadence: "custom", behavior: "set_aside", amount: 1000 })).rejects.toThrow(
      ZodError,
    );
    await expect(bad({ cadence: "monthly", behavior: "set_aside", amount: 0 })).rejects.toThrow(
      ZodError,
    );
    await expect(
      bad({ cadence: "weekly", behavior: "set_aside", amount: 1, day_of_week: 7 }),
    ).rejects.toThrow(ZodError);
    const other = await seed();
    await expect(
      setTarget(env, actor, {
        budget_id: s.bid,
        category_id: other.cats.Plain as string,
        ...DEFS.Plain,
      } as TargetSetInput),
    ).rejects.toThrow(NotFound);
    await expect(deleteTarget(env, actor, b)).rejects.toThrow(NotFound);
  });

  it("core and schema enums agree", () => {
    expect([...TargetCadence.options]).toEqual([...TARGET_CADENCES]);
    expect([...TargetBehavior.options]).toEqual([...TARGET_BEHAVIORS]);
    expect([...TargetStatus.options]).toEqual([...TARGET_STATUSES]);
    expect([...RepeatUnit.options]).toEqual([...REPEAT_UNITS]);
  });
});
