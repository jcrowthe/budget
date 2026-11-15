import { env } from "cloudflare:test";
import { ACCOUNT_TYPES, CLEARED_STATUSES } from "@budget/core/account-types";
import { AccountType } from "@budget/schema/accounts";
import { MonthDetailResponse } from "@budget/schema/months";
import { ClearedStatus } from "@budget/schema/transactions";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "../src/db/client";
import { NotFound } from "../src/middleware/errors";
import { createAccount } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import {
  buildSetAssignedBatch,
  moveMoney,
  setAssigned,
  setMonthNote,
} from "../src/services/months";
import { createTransaction } from "../src/services/transactions";
import { json } from "./helpers";

const actor = "user:tester@localhost";
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const DEC = "2026-12-01";

type Detail = Awaited<ReturnType<typeof readMonth>>;
async function readMonth(budgetId: string, month: string) {
  const res = await json(`/api/v1/budgets/${budgetId}/months/${month}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return MonthDetailResponse.parse(body).data;
}
const grp = (d: Detail, id: string) => d.groups.find((g) => g.id === id);
const row = (d: Detail, name: string) => {
  const c = d.groups.flatMap((g) => g.categories).find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return [c.assigned, c.activity, c.available];
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
  for (const name of ["Rent", "Groceries", "Fun"]) {
    cats[name] = (
      await createCategory(env, actor, { budget_id: bid, group_id: group.id, name })
    ).id;
  }
  const tx = (
    date: string,
    amount: number,
    category?: string,
    inflow = false,
    accountId = account.id,
  ) =>
    createTransaction(env, actor, {
      budget_id: bid,
      account_id: accountId,
      date,
      amount,
      category_id: category ?? null,
      inflow_to_ready_to_assign: inflow,
    });
  const assign = (name: string, month: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month, category_id: cats[name] as string, assigned });
  return { bid, account, group, cats, tx, assign };
}

async function logs(bid: string) {
  const { results } = await env.DB.prepare(
    "SELECT actor, entity_type, action FROM change_log WHERE budget_id = ?",
  )
    .bind(bid)
    .all<{ actor: string; entity_type: string; action: string }>();
  return results;
}

describe("worked example through the services", () => {
  it("replays steps 1 to 7 and keeps history, REST and MCP in agreement", async () => {
    const s = await seed();
    const { bid, cats } = s;
    // Steps 1-3
    await s.tx("2026-10-05", 500000, undefined, true);
    await s.assign("Rent", OCT, 300000);
    await s.assign("Groceries", OCT, 150000);
    await s.assign("Fun", OCT, 20000);
    await s.tx("2026-10-10", -100000, cats.Groceries);
    await s.tx("2026-10-12", -45000, cats.Fun);
    let oct = await readMonth(bid, OCT);
    expect(row(oct, "Rent")).toEqual([300000, 0, 300000]);
    expect(row(oct, "Groceries")).toEqual([150000, -100000, 50000]);
    expect(row(oct, "Fun")).toEqual([20000, -45000, -25000]);
    expect(grp(oct, s.group.id)).toMatchObject({
      assigned: 470000,
      activity: -145000,
      available: 325000,
    });
    expect(oct.ready_to_assign).toBe(30000);
    // Step 4
    await s.tx("2026-11-15", 1000000, undefined, true);
    await s.assign("Rent", NOV, 450000);
    await s.assign("Groceries", NOV, 205000);
    await s.assign("Fun", NOV, 0);
    await s.tx("2026-11-18", -60000, cats.Groceries);
    await s.tx("2026-11-19", -50000, cats.Fun);
    let nov = await readMonth(bid, NOV);
    expect(row(nov, "Rent")).toEqual([450000, 0, 750000]);
    expect(row(nov, "Groceries")).toEqual([205000, -60000, 195000]);
    expect(row(nov, "Fun")).toEqual([0, -50000, -50000]);
    expect(grp(nov, s.group.id)).toMatchObject({
      assigned: 655000,
      activity: -110000,
      available: 895000,
    });
    expect(nov.rta_breakdown.cash_overspending_previous).toBe(-25000);
    expect(nov.ready_to_assign).toBe(350000);
    // Step 5: cover
    await moveMoney(env, actor, {
      budget_id: bid,
      month: OCT,
      from_category_id: cats.Groceries as string,
      to_category_id: cats.Fun as string,
      amount: 25000,
    });
    oct = await readMonth(bid, OCT);
    expect(row(oct, "Fun")).toEqual([45000, -45000, 0]);
    expect(row(oct, "Groceries")).toEqual([125000, -100000, 25000]);
    nov = await readMonth(bid, NOV);
    expect(row(nov, "Groceries")[2]).toBe(170000);
    expect(grp(nov, s.group.id)).toMatchObject({
      assigned: 655000,
      activity: -110000,
      available: 870000,
    });
    expect(nov.ready_to_assign).toBe(375000);
    // Step 6
    let dec = await readMonth(bid, DEC);
    expect(row(dec, "Rent")).toEqual([0, 0, 750000]);
    expect(row(dec, "Groceries")).toEqual([0, 0, 170000]);
    expect(row(dec, "Fun")).toEqual([0, 0, 0]);
    await s.assign("Rent", DEC, 100000);
    dec = await readMonth(bid, DEC);
    expect(row(dec, "Rent")[2]).toBe(850000);
    expect(dec.rta_breakdown).toMatchObject({
      assigned_in_month: -100000,
      cash_overspending_previous: -50000,
      left_over_from_previous: 375000,
    });
    expect(dec.ready_to_assign).toBe(225000);
    nov = await readMonth(bid, NOV);
    expect(nov.rta_breakdown.assigned_in_future).toBe(-100000);
    expect(nov.ready_to_assign).toBe(275000);

    // Acceptance 5: moves and RTA
    const before = nov.ready_to_assign;
    await moveMoney(env, actor, {
      budget_id: bid,
      month: NOV,
      from_category_id: cats.Rent as string,
      to_category_id: cats.Groceries as string,
      amount: 5000,
    });
    expect((await readMonth(bid, NOV)).ready_to_assign).toBe(before);
    await moveMoney(env, actor, {
      budget_id: bid,
      month: NOV,
      from_category_id: cats.Rent as string,
      to_category_id: null,
      amount: 10000,
    });
    expect((await readMonth(bid, NOV)).ready_to_assign).toBe(before + 10000);
    await moveMoney(env, actor, {
      budget_id: bid,
      month: NOV,
      from_category_id: null,
      to_category_id: cats.Rent as string,
      amount: 10000,
    });
    await moveMoney(env, actor, {
      budget_id: bid,
      month: NOV,
      from_category_id: cats.Groceries as string,
      to_category_id: cats.Rent as string,
      amount: 5000,
    });
    expect((await readMonth(bid, NOV)).ready_to_assign).toBe(before);

    // Step 7: reassign Fun's rows to a new category (direct SQL stands in for EXF-494)
    const target = await createCategory(env, actor, {
      budget_id: bid,
      group_id: s.group.id,
      name: "Target",
    });
    await s.assign("Rent", NOV, 440000);
    await env.DB.batch([
      env.DB.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?").bind(
        target.id,
        cats.Fun,
      ),
      env.DB.prepare("DELETE FROM month_categories WHERE category_id = ? AND month = ?").bind(
        cats.Fun,
        NOV,
      ),
      env.DB.prepare("UPDATE month_categories SET category_id = ? WHERE category_id = ?").bind(
        target.id,
        cats.Fun,
      ),
      env.DB.prepare("UPDATE categories SET deleted_at = ? WHERE id = ?").bind(
        new Date().toISOString(),
        cats.Fun,
      ),
    ]);
    await setAssigned(env, actor, {
      budget_id: bid,
      month: NOV,
      category_id: target.id,
      assigned: 15000,
    });
    oct = await readMonth(bid, OCT);
    expect(row(oct, "Target")).toEqual([45000, -45000, 0]);
    nov = await readMonth(bid, NOV);
    expect(row(nov, "Target")).toEqual([15000, -50000, -35000]);

    // Acceptance 10: integers and first-of-month dates
    for (const d of [oct, nov, dec]) {
      expect(d.month).toMatch(/^\d{4}-\d{2}-01$/);
      for (const n of [d.ready_to_assign, ...Object.values(d.rta_breakdown)]) {
        expect(Number.isSafeInteger(n)).toBe(true);
      }
    }

    // Acceptance 6: history
    const all = await logs(bid);
    expect(all.every((l) => l.actor === actor)).toBe(true);
    expect(all.filter((l) => l.entity_type === "month_category").length).toBeGreaterThanOrEqual(10);

    // Acceptance 9: list
    const res = await json(`/api/v1/budgets/${bid}/months?from=${OCT}&to=${DEC}`);
    expect(res.status).toBe(200);
    const list = ((await res.json()) as { data: { months: unknown } }).data.months as {
      month: string;
      ready_to_assign: number;
      assigned: number;
    }[];
    expect(list.map((m) => m.month)).toEqual([OCT, NOV, DEC]);
    for (const m of list) {
      const d = await readMonth(bid, m.month);
      expect(m.ready_to_assign).toBe(d.ready_to_assign);
      expect(m.assigned).toBe(
        d.groups.flatMap((g) => g.categories).reduce((a, c) => a + c.assigned, 0),
      );
    }

    // Acceptance 8: tracking account changes nothing; MCP equals REST
    const tracking = await createAccount(env, actor, {
      budget_id: bid,
      name: "Tracking",
      type: "otherAsset",
      on_budget: false,
    });
    const novBefore = await readMonth(bid, NOV);
    await s.tx("2026-11-03", -99000, cats.Groceries, false, tracking.id);
    expect(await readMonth(bid, NOV)).toEqual(novBefore);
    const { tools } = await import("../src/mcp/tools/months");
    const viaMcp = await tools[0]?.run({ budget_id: bid, month: NOV } as never, { env, actor });
    expect(viaMcp).toEqual(novBefore);
  });

  it("writes one history row per change with the actor", async () => {
    const s = await seed();
    const base = (await logs(s.bid)).length; // budget + 14 defaults + account + group + 3 categories
    expect(base).toBe(20);
    const g = s.cats.Groceries as string;
    const f = s.cats.Fun as string;
    await s.assign("Rent", OCT, 1000);
    await moveMoney(env, "mcp:x", {
      budget_id: s.bid,
      month: OCT,
      from_category_id: g,
      to_category_id: f,
      amount: 1000,
    });
    await moveMoney(env, "mcp:x", {
      budget_id: s.bid,
      month: OCT,
      from_category_id: g,
      to_category_id: null,
      amount: 1000,
    });
    await setMonthNote(env, "mcp:x", { budget_id: s.bid, month: OCT, note: "hi" });
    await s.tx("2026-10-02", 1000);
    const all = await logs(s.bid);
    expect(all.length).toBe(base + 1 + 2 + 1 + 1 + 1);
    expect(all.filter((l) => l.actor === "mcp:x").length).toBe(4);
    const note = await readMonth(s.bid, OCT);
    expect(note.note).toBe("hi");
    await setMonthNote(env, actor, { budget_id: s.bid, month: OCT, note: null });
    expect((await readMonth(s.bid, OCT)).note).toBeNull();
  });

  it("a failing change_log leaves no month_categories row", async () => {
    const s = await seed();
    const db = getDb(env);
    const batch = buildSetAssignedBatch(
      db,
      {
        budgetId: s.bid,
        month: OCT,
        categoryId: s.cats.Rent as string,
        assigned: 5,
        updatedAt: "x",
      },
      {
        budgetId: s.bid,
        actor,
        action: "bogus" as never,
        entityType: "month_category",
        entityId: "x",
        before: null,
        after: null,
      },
    );
    await expect(db.batch([...batch])).rejects.toThrow();
    const n = await env.DB.prepare("SELECT count(*) AS n FROM month_categories WHERE budget_id = ?")
      .bind(s.bid)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("concurrent writers", () => {
  type Chain = { before: number; after: number };
  async function chain(bid: string, categoryId: string): Promise<Chain[]> {
    const { results } = await env.DB.prepare(
      "SELECT before_json, after_json FROM change_log WHERE budget_id = ? AND entity_type = 'month_category' AND entity_id = ? ORDER BY created_at, rowid",
    )
      .bind(bid, `${categoryId}:${OCT}`)
      .all<{ before_json: string; after_json: string }>();
    return results.map((r) => ({
      before: JSON.parse(r.before_json).assigned,
      after: JSON.parse(r.after_json).assigned,
    }));
  }
  const cell = async (bid: string, categoryId: string) =>
    (
      await env.DB.prepare(
        "SELECT assigned FROM month_categories WHERE budget_id = ? AND month = ? AND category_id = ?",
      )
        .bind(bid, OCT, categoryId)
        .first<{ assigned: number }>()
    )?.assigned ?? 0;

  it("setAssigned: every logged change happened, and the chain ends at the final value", async () => {
    const s = await seed();
    const rent = s.cats.Rent as string;
    const calls = await Promise.allSettled(
      [100, 200, 300].map((assigned) =>
        setAssigned(env, actor, { budget_id: s.bid, month: OCT, category_id: rent, assigned }),
      ),
    );
    const ok = calls.filter((c) => c.status === "fulfilled").length;
    const c = await chain(s.bid, rent);
    expect(c.length).toBe(ok);
    expect(ok).toBeGreaterThan(0);
    let prev = 0;
    for (const link of c) {
      expect(link.before).toBe(prev);
      prev = link.after;
    }
    expect(prev).toBe(await cell(s.bid, rent));
  });

  it("moveMoney: no lost update, and each log row's before matches the running total", async () => {
    const s = await seed();
    const rent = s.cats.Rent as string;
    const fun = s.cats.Fun as string;
    const calls = await Promise.allSettled(
      [1, 2, 3].map(() =>
        moveMoney(env, actor, {
          budget_id: s.bid,
          month: OCT,
          from_category_id: null,
          to_category_id: rent,
          amount: 10,
        }),
      ),
    );
    const ok = calls.filter((c) => c.status === "fulfilled").length;
    expect(ok).toBe(3);
    const c = await chain(s.bid, rent);
    expect(c.map((l) => [l.before, l.after])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(await cell(s.bid, rent)).toBe(30);

    // Two-sided moves in both directions at once keep the pair's total and the chains exact.
    await Promise.allSettled([
      moveMoney(env, actor, {
        budget_id: s.bid,
        month: OCT,
        from_category_id: rent,
        to_category_id: fun,
        amount: 5,
      }),
      moveMoney(env, actor, {
        budget_id: s.bid,
        month: OCT,
        from_category_id: fun,
        to_category_id: rent,
        amount: 2,
      }),
    ]);
    const [r, f] = [await cell(s.bid, rent), await cell(s.bid, fun)];
    expect(r + f).toBe(30);
    for (const [id, final] of [
      [rent, r],
      [fun, f],
    ] as const) {
      const ch = await chain(s.bid, id);
      let prev = 0;
      for (const link of ch) {
        expect(link.before).toBe(prev);
        prev = link.after;
      }
      expect(prev).toBe(final);
    }
  });

  it("concurrent creates get distinct sort orders", async () => {
    const s = await seed();
    const group = await createCategoryGroup(env, actor, { budget_id: s.bid, name: "More" });
    const made = await Promise.all(
      ["A", "B", "C"].map((name) =>
        createCategory(env, actor, { budget_id: s.bid, group_id: group.id, name }),
      ),
    );
    expect(new Set(made.map((c) => c.sort)).size).toBe(3);
    const accts = await Promise.all(
      ["A", "B", "C"].map((name) =>
        createAccount(env, actor, { budget_id: s.bid, name, type: "cash", on_budget: true }),
      ),
    );
    expect(new Set(accts.map((a) => a.sort)).size).toBe(3);
  });

  it("refuses years outside 1900 to 2199", async () => {
    const s = await seed();
    await expect(
      setAssigned(env, actor, {
        budget_id: s.bid,
        month: "0000-01-01",
        category_id: s.cats.Rent as string,
        assigned: 1,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(s.tx("0000-01-01", 1000)).rejects.toBeInstanceOf(ZodError);
  });
});

describe("errors and rules", () => {
  it("returns 404 and 422", async () => {
    const missing = await json(`/api/v1/budgets/${crypto.randomUUID()}/months/${NOV}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { name: "not_found" } });
    const s = await seed();
    for (const m of ["2026-11-15", "2026-13-01"]) {
      const res = await json(`/api/v1/budgets/${s.bid}/months/${m}`);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { name: "unprocessable_entity" } });
    }
    expect((await json(`/api/v1/budgets/${s.bid}/months?from=${DEC}&to=${NOV}`)).status).toBe(422);
    expect(
      (await json(`/api/v1/budgets/${s.bid}/months?from=2010-01-01&to=2026-01-01`)).status,
    ).toBe(422);
  });

  it("validates service inputs and plan ownership", async () => {
    const a = await seed();
    const b = await seed();
    await expect(
      createTransaction(env, actor, {
        budget_id: a.bid,
        account_id: a.account.id,
        date: OCT,
        amount: 1,
        category_id: a.cats.Rent as string,
        inflow_to_ready_to_assign: true,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createCategory(env, actor, { budget_id: a.bid, group_id: b.group.id, name: "X" }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("keeps the schema literal lists equal to core's", () => {
    expect([...AccountType.options]).toEqual([...ACCOUNT_TYPES]);
    expect([...ClearedStatus.options]).toEqual([...CLEARED_STATUSES]);
  });
});
