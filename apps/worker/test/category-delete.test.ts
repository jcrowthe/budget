import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import * as categoriesRepo from "../src/repositories/categories";
import * as targetsRepo from "../src/repositories/targets";
import { createAccount } from "../src/services/accounts";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { buildDeleteBatch } from "../src/services/category-delete";
import { setAssigned } from "../src/services/months";
import { setTarget } from "../src/services/targets";
import { createTransaction } from "../src/services/transactions";
import { actor, api, group, type Json, logs, mcp, month, plan, send } from "./category-helpers";
import { apiPaths } from "./surface";

const SEP = "2026-09-01";
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const MONTHS = [SEP, OCT, NOV, "2026-12-01", "2027-01-01"];

async function seed() {
  const bid = await plan();
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "Spend" });
  const fun = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "Fun" }))
    .id;
  const target = (
    await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "Target" })
  ).id;
  const tx = (date: string, amount: number, category: string | null = null, inflow = false) =>
    createTransaction(env, actor, {
      budget_id: bid,
      account_id: account.id,
      date,
      amount,
      category_id: category,
      inflow_to_ready_to_assign: inflow,
    });
  const assign = (category_id: string, m: string, assigned: number) =>
    setAssigned(env, actor, { budget_id: bid, month: m, category_id, assigned });
  const del = (id: string, to?: string) =>
    send("DELETE", api(bid, `/categories/${id}${to ? `?reassign_to=${to}` : ""}`));
  const rta = async () =>
    Promise.all(MONTHS.map(async (m) => (await month(bid, m)).ready_to_assign));
  const cell = (m: Awaited<ReturnType<typeof month>>, id: string) => {
    const c = m.groups.flatMap((x) => x.categories).find((x) => x.id === id);
    return c ? [c.assigned, c.activity, c.available] : null;
  };
  return { bid, account, g, fun, target, tx, assign, del, rta, cell };
}

describe("delete without history", () => {
  it("soft-deletes at once and logs the actor; a group goes with its categories", async () => {
    const s = await seed();
    const res = await s.del(s.fun);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.deleted).toMatchObject({
      category_ids: [s.fun],
      group_id: null,
      reassigned_to: null,
    });
    const row = await env.DB.prepare("select deleted_at from categories where id = ?")
      .bind(s.fun)
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).not.toBeNull();
    expect((await logs(s.bid, "category")).filter((l) => l.action === "delete")).toMatchObject([
      { entity_id: s.fun, actor },
    ]);
    expect((await s.del(s.fun)).status).toBe(404);

    const gr = await send("DELETE", api(s.bid, `/category_groups/${s.g.id}`));
    expect(gr.status).toBe(200);
    expect(((await gr.json()) as Json).data.deleted).toMatchObject({
      group_id: s.g.id,
      category_ids: [s.target],
    });
    expect((await month(s.bid, NOV)).groups.some((x) => x.id === s.g.id)).toBe(false);
    expect((await logs(s.bid, "category_group")).filter((l) => l.action === "delete")).toHaveLength(
      1,
    );
    const empty = (
      (await (await send("POST", api(s.bid, "/category_groups"), { name: "Empty" })).json()) as Json
    ).data.category_group;
    expect((await send("DELETE", api(s.bid, `/category_groups/${empty.id}`))).status).toBe(200);
  });

  it("answers 409 with history, 422 for a bad target, 404 for unknown ids", async () => {
    const s = await seed();
    await s.assign(s.fun, OCT, 1000);
    const conflict = await s.del(s.fun);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as Json).error).toMatchObject({ name: "history_exists" });
    const usage = (
      (await (await send("GET", api(s.bid, `/categories/${s.fun}/usage`))).json()) as Json
    ).data.usage;
    expect(usage).toEqual({
      category_count: 1,
      transaction_count: 0,
      has_assigned: true,
      has_history: true,
    });

    for (const to of [s.fun, "nope", crypto.randomUUID()]) {
      const r = await s.del(s.fun, to);
      expect(r.status).toBe(422);
      expect(((await r.json()) as Json).error.name).toBe("invalid_reassign_target");
    }
    const other = await seed();
    expect((await s.del(s.fun, other.target)).status).toBe(422);
    // a deleted category
    await s.del(s.target);
    expect((await s.del(s.fun, s.target)).status).toBe(422);
    // a category of the group being deleted
    const s2 = await seed();
    await s2.assign(s2.fun, OCT, 1000);
    const r = await send(
      "DELETE",
      api(s2.bid, `/category_groups/${s2.g.id}?reassign_to=${s2.target}`),
    );
    expect(r.status).toBe(422);
    expect(
      (await send("DELETE", api(s2.bid, `/category_groups/${crypto.randomUUID()}`))).status,
    ).toBe(404);
    expect((await send("DELETE", api(crypto.randomUUID(), `/categories/${s2.fun}`))).status).toBe(
      404,
    );
  });

  it("a transaction counts as history; a deleted one does not", async () => {
    const s = await seed();
    const t = await s.tx("2026-10-05", -1000, s.fun);
    expect((await s.del(s.fun)).status).toBe(409);
    await env.DB.prepare("update transactions set deleted_at = ? where id = ?")
      .bind(new Date().toISOString(), t.id)
      .run();
    expect((await s.del(s.fun)).status).toBe(200);
  });
});

describe("delete with reassignment", () => {
  it("engine example: the target takes the history and Ready to Assign holds until the cancelled overspending", async () => {
    const s = await seed();
    await s.tx("2026-09-02", 500000, null, true);
    await s.assign(s.fun, OCT, 45000);
    await s.tx("2026-10-12", -45000, s.fun);
    await s.tx("2026-11-19", -50000, s.fun);
    await s.assign(s.target, NOV, 15000);
    await setTarget(env, actor, {
      budget_id: s.bid,
      category_id: s.fun,
      cadence: "monthly",
      behavior: "set_aside",
      amount: 10000,
    });
    const before = await s.rta();
    const res = await s.del(s.fun, s.target);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.deleted).toMatchObject({
      reassigned_to: s.target,
      transactions_moved: 2,
      months_merged: 1,
    });
    const after = await s.rta();
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).toBe((before[3] as number) + 15000);
    expect(
      (await month(s.bid, OCT)).groups.some((x) => x.categories.some((c) => c.id === s.fun)),
    ).toBe(false);
    expect(s.cell(await month(s.bid, OCT), s.target)).toEqual([45000, -45000, 0]);
    expect(s.cell(await month(s.bid, NOV), s.target)).toEqual([15000, -50000, -35000]);

    const targets = await env.DB.prepare("select count(*) n from targets where category_id = ?")
      .bind(s.fun)
      .first<{ n: number }>();
    expect(targets?.n).toBe(0);
    const moved = await env.DB.prepare("select count(*) n from transactions where category_id = ?")
      .bind(s.target)
      .first<{ n: number }>();
    expect(moved?.n).toBe(2);
    const all = await logs(s.bid);
    const mine = all.filter((l) => l.actor === actor);
    expect(
      mine.filter(
        (l) => l.entity_type === "transaction" && l.after_json?.includes("reassigned_from"),
      ),
    ).toHaveLength(2);
    expect(
      mine.filter(
        (l) => l.entity_type === "month_category" && l.entity_id === `${s.target}:${OCT}`,
      ),
    ).toHaveLength(1);
    expect(mine.filter((l) => l.entity_type === "target" && l.action === "delete")).toHaveLength(1);
    expect(
      mine.filter(
        (l) => l.entity_type === "category" && l.action === "delete" && l.entity_id === s.fun,
      ),
    ).toHaveLength(1);
  });

  it("with no overspending to cancel, Ready to Assign is unchanged in every month", async () => {
    const s = await seed();
    await s.tx("2026-09-02", 500000, null, true);
    await s.assign(s.fun, OCT, 20000);
    await s.tx("2026-10-12", -5000, s.fun);
    await s.assign(s.target, OCT, 10000);
    const before = await s.rta();
    expect((await s.del(s.fun, s.target)).status).toBe(200);
    expect(await s.rta()).toEqual(before);
    expect(s.cell(await month(s.bid, OCT), s.target)).toEqual([30000, -5000, 25000]);
    expect(s.cell(await month(s.bid, NOV), s.target)?.[2]).toBe(25000);
  });

  it("a group delete merges every category, hidden ones too", async () => {
    const s = await seed();
    const bills = group(await month(s.bid, NOV), "Bills");
    const [a, b] = [bills.categories[0], bills.categories[1]];
    await s.assign(a?.id as string, OCT, 7000);
    await s.assign(b?.id as string, OCT, 3000);
    await send("PATCH", api(s.bid, `/categories/${b?.id}`), { hidden: true });
    const before = await s.rta();
    const usage = (
      (await (await send("GET", api(s.bid, `/category_groups/${bills.id}/usage`))).json()) as Json
    ).data.usage;
    expect(usage).toMatchObject({ category_count: 3, has_assigned: true });
    const r = await send(
      "DELETE",
      api(s.bid, `/category_groups/${bills.id}?reassign_to=${s.target}`),
    );
    expect(r.status).toBe(200);
    expect(s.cell(await month(s.bid, OCT), s.target)?.[0]).toBe(10000);
    expect(await s.rta()).toEqual(before);
  });

  it("is atomic: a failing statement at the end leaves nothing half done", async () => {
    const s = await seed();
    await s.tx("2026-09-02", 500000, null, true);
    await s.assign(s.fun, OCT, 45000);
    await s.tx("2026-10-12", -45000, s.fun);
    await setTarget(env, actor, {
      budget_id: s.bid,
      category_id: s.fun,
      cadence: "monthly",
      behavior: "set_aside",
      amount: 10000,
    });
    const snap = async () =>
      JSON.stringify(
        await Promise.all(
          ["transactions", "month_categories", "targets", "categories", "change_log"].map(
            async (t) => (await env.DB.prepare(`select * from ${t} order by rowid`).all()).results,
          ),
        ),
      );
    const before = await snap();
    const db = getDb(env);
    const row = await categoriesRepo.findActive(db, s.bid, s.fun);
    const stmts = buildDeleteBatch(db, {
      budgetId: s.bid,
      actor,
      now: new Date().toISOString(),
      categoryIds: [s.fun],
      group: null,
      categories: row ? [row] : [],
      targetId: s.target,
      targets: (await targetsRepo.listForBudget(db, s.bid)).filter((t) => t.categoryId === s.fun),
    });
    expect(stmts.length).toBeGreaterThan(6);
    // The batch alone works (the guard holds); a last statement that violates NOT NULL must undo all of it.
    const failing = db.insert(changeLog).values({
      id: crypto.randomUUID(),
      budgetId: s.bid,
      actor: null as never,
      action: "create",
      entityType: "x",
      entityId: "x",
      createdAt: "x",
    });
    await expect(db.batch([...stmts, failing] as never)).rejects.toThrow(/NOT NULL|constraint/i);
    expect(await snap()).toBe(before);
  });

  it("MCP delete_category and delete_category_group equal REST", async () => {
    const s = await seed();
    await s.assign(s.fun, OCT, 1000);
    const noTarget = await mcp("delete_category", { budget_id: s.bid, category_id: s.fun });
    expect(noTarget.isError).toBe(true);
    const ok = await mcp("delete_category", {
      budget_id: s.bid,
      category_id: s.fun,
      reassign_to: s.target,
    });
    expect(ok.structuredContent.deleted).toMatchObject({
      category_ids: [s.fun],
      reassigned_to: s.target,
      months_merged: 1,
    });
    const bills = group(await month(s.bid, NOV), "Bills");
    const gone = await mcp("delete_category_group", { budget_id: s.bid, group_id: bills.id });
    expect(gone.structuredContent.deleted.group_id).toBe(bills.id);
    const rows = (await logs(s.bid)).filter((l) => l.actor.startsWith("mcp:"));
    expect(rows.length).toBeGreaterThan(3);
  });

  it("lists the paths", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/categories/{category_id}");
  });
});
