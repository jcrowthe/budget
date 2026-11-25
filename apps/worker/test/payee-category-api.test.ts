import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import { buildPayeeUpdateBatch } from "../src/services/payees";
import { data, send } from "./account-helpers";
import { mcp } from "./category-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { apiPaths, listedToolNames } from "./surface";

const ACTOR = "user:tester@localhost";

async function world() {
  const w = await payeeWorld();
  const g = (
    await data(await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ G" }))
  ).category_group as Json;
  const mk = async (name: string, group = g.id as string) =>
    (
      await data(
        await send(`/api/v1/budgets/${w.bid}/categories`, "POST", {
          group_id: group,
          name: `ZZ ${name}`,
        }),
      )
    ).category.id as string;
  const fun = await mk("Fun");
  const groceries = await mk("Groceries");
  const patch = (id: string, body: Json) => send(`${P(w.bid)}/${id}`, "PATCH", body);
  const payeeLogs = async (id: string) =>
    (
      await env.DB.prepare(
        "select actor, action, before_json, after_json from change_log where entity_type = 'payee' and action = 'update' and entity_id = ? order by rowid",
      )
        .bind(id)
        .all<Json>()
    ).results;
  return { ...w, g, mk, fun, groceries, patch, payeeLogs };
}

describe("PATCH payee: category mode and fixed choice (EXF-515)", () => {
  it("round trips history → fixed → off → history, keeping the fixed value", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.groceries });
    const id = await s.id("ZZ P");
    const p0 = (await s.list()).find((p) => p.id === id) as Json;
    expect(p0).toMatchObject({
      category_mode: "history",
      fixed_category_id: null,
      fixed_inflow_to_ready_to_assign: false,
      default_category_id: s.groceries,
    });
    const fixed = await data(
      await s.patch(id, { category_mode: "fixed", fixed_category_id: s.fun }),
    );
    expect(fixed.payee).toMatchObject({
      category_mode: "fixed",
      fixed_category_id: s.fun,
      default_category_id: s.fun,
    });
    const off = await data(await s.patch(id, { category_mode: "off" }));
    expect(off.payee).toMatchObject({
      category_mode: "off",
      fixed_category_id: s.fun,
      default_category_id: null,
    });
    const back = await data(await s.patch(id, { category_mode: "history" }));
    expect(back.payee).toMatchObject({
      category_mode: "history",
      fixed_category_id: s.fun,
      default_category_id: s.groceries,
    });
    expect((await s.list()).find((p) => p.id === id)).toMatchObject(back.payee);
  });

  it("fixes Ready to Assign, and a stored fixed value serves a later switch to fixed", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.groceries });
    const id = await s.id("ZZ P");
    const r = await data(
      await s.patch(id, { category_mode: "fixed", fixed_inflow_to_ready_to_assign: true }),
    );
    expect(r.payee).toMatchObject({
      fixed_category_id: null,
      fixed_inflow_to_ready_to_assign: true,
      default_category_id: null,
      default_inflow_to_ready_to_assign: true,
    });
    await s.patch(id, { category_mode: "off" });
    const again = await s.patch(id, { category_mode: "fixed" });
    expect(again.status).toBe(200);
  });

  it("writes one change_log row by the actor with the category fields; with a name it is still one row", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.groceries });
    const id = await s.id("ZZ P");
    await s.patch(id, { category_mode: "fixed", fixed_category_id: s.fun });
    await s.patch(id, { name: "ZZ P2", category_mode: "off" });
    const rows = await s.payeeLogs(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actor).toBe(ACTOR);
    expect(JSON.parse(rows[0]?.before_json)).toEqual({
      id,
      name: "ZZ P",
      hidden: false,
      category_mode: "history",
      fixed_category_id: null,
      fixed_inflow_to_ready_to_assign: false,
    });
    expect(JSON.parse(rows[0]?.after_json)).toMatchObject({
      category_mode: "fixed",
      fixed_category_id: s.fun,
      fixed_inflow_to_ready_to_assign: false,
    });
    expect(JSON.parse(rows[1]?.after_json)).toMatchObject({ name: "ZZ P2", category_mode: "off" });
  });

  it("refuses: 403 transfer entry and system payee, 404 unknown", async () => {
    const s = await world();
    const transfer = (await s.list()).find((p) => p.transfer_account_id) as Json;
    const sys = (await s.list()).find((p) => p.system === "starting_balance") as Json;
    expect((await s.patch(transfer.id, { category_mode: "off" })).status).toBe(403);
    expect((await s.patch(sys.id, { category_mode: "off" })).status).toBe(403);
    expect((await s.patch("nope", { category_mode: "off" })).status).toBe(404);
  });

  it("refuses with 422: fixed without a value, unknown or deleted category, category + RTA", async () => {
    const s = await world();
    await s.tx("ZZ P");
    const id = await s.id("ZZ P");
    expect((await s.patch(id, { category_mode: "fixed" })).status).toBe(422);
    expect((await s.patch(id, { category_mode: "fixed", fixed_category_id: "nope" })).status).toBe(
      422,
    );
    const gone = await s.mk("Gone");
    await env.DB.prepare("update categories set deleted_at = '2026-11-20' where id = ?")
      .bind(gone)
      .run();
    expect((await s.patch(id, { category_mode: "fixed", fixed_category_id: gone })).status).toBe(
      422,
    );
    // A category whose group is deleted is not live either.
    const g2 = (
      await data(await send(`/api/v1/budgets/${s.bid}/category_groups`, "POST", { name: "ZZ G2" }))
    ).category_group as Json;
    const inGone = await s.mk("InGone", g2.id);
    await env.DB.prepare("update category_groups set deleted_at = '2026-11-20' where id = ?")
      .bind(g2.id)
      .run();
    expect((await s.patch(id, { fixed_category_id: inGone })).status).toBe(422);
    expect(
      (
        await s.patch(id, {
          category_mode: "fixed",
          fixed_category_id: s.fun,
          fixed_inflow_to_ready_to_assign: true,
        })
      ).status,
    ).toBe(422);
    expect((await s.patch(id, {})).status).toBe(422);
    expect((await s.list()).find((p) => p.id === id)).toMatchObject({ category_mode: "history" });
  });
});

describe("recent transactions of a payee (EXF-515)", () => {
  it("counts only counted rows: never split lines, transfers, scheduled, uncategorised or deleted; 3 in recency order", async () => {
    const s = await world();
    const b = s.bid;
    const T = (body: Json) =>
      send(`/api/v1/budgets/${b}/transactions`, "POST", {
        account_id: s.acct,
        amount: -1000,
        payee_name: "ZZ R",
        ...body,
      });
    // Not counted:
    const split = await data(
      await T({
        date: "2026-11-30",
        amount: -300,
        subtransactions: [
          { amount: -100, category_id: s.fun, payee_name: "ZZ R" },
          { amount: -200, category_id: s.groceries, payee_name: "ZZ R" },
        ],
      }),
    );
    expect(split.transaction.id).toBeTruthy();
    await T({ date: "2026-11-29" }); // uncategorised
    const del = await data(await T({ date: "2026-11-28", category_id: s.fun }));
    await send(`/api/v1/budgets/${b}/transactions/${del.transaction.id}`, "DELETE");
    await s.sched("ZZ R");
    const acct2 = (
      await data(
        await send(`/api/v1/budgets/${b}/accounts`, "POST", {
          name: "ZZ Savings",
          type: "savings",
          balance: 0,
          date: "2026-11-01",
        }),
      )
    ).account.id as string;
    await send(`/api/v1/budgets/${b}/transactions`, "POST", {
      account_id: s.acct,
      amount: -50,
      date: "2026-11-27",
      transfer_account_id: acct2,
    });
    // A row in a deleted account is not counted either.
    await data(
      await send(`/api/v1/budgets/${b}/transactions`, "POST", {
        account_id: acct2,
        amount: -1,
        date: "2026-11-26",
        payee_name: "ZZ R",
        category_id: s.fun,
      }),
    );
    await env.DB.prepare("update accounts set deleted_at = '2026-11-20' where id = ?")
      .bind(acct2)
      .run();
    // Counted: four rows, two on the same date.
    const c1 = await data(await T({ date: "2026-11-10", category_id: s.fun }));
    const c2 = await data(await T({ date: "2026-11-12", category_id: s.groceries }));
    const c3 = await data(await T({ date: "2026-11-12", category_id: s.fun }));
    await T({ date: "2026-11-01", category_id: s.fun });
    const id = await s.id("ZZ R");
    const res = await send(`${P(b)}/${id}/recent-transactions`, "GET");
    expect(res.status).toBe(200);
    const { transactions } = await data(res);
    expect(transactions.map((t: Json) => t.id)).toEqual([
      c2.transaction.id,
      c3.transaction.id,
      c1.transaction.id,
    ]);
    expect(Object.keys(transactions[0]).sort()).toEqual(
      [
        "account_id",
        "amount",
        "category_group_name",
        "category_id",
        "category_name",
        "date",
        "id",
        "inflow_to_ready_to_assign",
      ].sort(),
    );
    expect(transactions[0]).toMatchObject({
      category_name: "ZZ Groceries",
      category_group_name: "ZZ G",
      inflow_to_ready_to_assign: false,
      amount: -1000,
      date: "2026-11-12",
    });
    const five = await data(await send(`${P(b)}/${id}/recent-transactions?limit=10`, "GET"));
    expect(five.transactions).toHaveLength(4);
    expect((await send(`${P(b)}/${id}/recent-transactions?limit=0`, "GET")).status).toBe(422);
    expect((await send(`${P(b)}/${id}/recent-transactions?limit=11`, "GET")).status).toBe(422);
    const transfer = (await s.list()).find((p) => p.transfer_account_id) as Json;
    expect((await send(`${P(b)}/${transfer.id}/recent-transactions`, "GET")).status).toBe(403);
    expect((await send(`${P(b)}/nope/recent-transactions`, "GET")).status).toBe(404);
  });
});

describe("MCP tools of the payee category (EXF-515)", () => {
  it("set_payee_category_mode and list_payee_recent_transactions return the REST data", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.groceries, date: "2026-11-10" });
    await s.tx("ZZ P", { category_id: s.fun, date: "2026-11-11" });
    const id = await s.id("ZZ P");
    const viaTool = await mcp("set_payee_category_mode", {
      budget_id: s.bid,
      payee_id: id,
      category_mode: "fixed",
      fixed_category_id: s.fun,
    });
    expect(viaTool.isError).toBeFalsy();
    const rest = (await s.list()).find((p) => p.id === id);
    expect(viaTool.structuredContent?.payee).toEqual(rest);
    const recent = await mcp("list_payee_recent_transactions", { budget_id: s.bid, payee_id: id });
    const restRecent = await data(await send(`${P(s.bid)}/${id}/recent-transactions`, "GET"));
    expect(recent.structuredContent).toEqual(restRecent);
    expect(restRecent.transactions).toHaveLength(2);
    const bad = await mcp("set_payee_category_mode", {
      budget_id: s.bid,
      payee_id: id,
      category_mode: "fixed",
      fixed_category_id: "nope",
    });
    expect(bad.isError).toBe(true);
  });

  it("the surface lists the path and both tools, 117 in all", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/payees/{payee_id}/recent-transactions",
    );
    const names = await listedToolNames();
    expect(names).toEqual(
      expect.arrayContaining(["set_payee_category_mode", "list_payee_recent_transactions"]),
    );
    expect(names).toHaveLength(117);
  });
});

describe("atomicity of the PATCH batch (EXF-515)", () => {
  it("a failing statement appended to the batch leaves the payee and change_log unchanged", async () => {
    const s = await world();
    await s.tx("ZZ P", { category_id: s.groceries });
    const id = await s.id("ZZ P");
    const db = getDb(env);
    const stmts = buildPayeeUpdateBatch(db, {
      budgetId: s.bid,
      actor: ACTOR,
      now: new Date().toISOString(),
      row: (await s.list()).find((p) => p.id === id) as never,
      name: "ZZ P",
      hidden: false,
      mode: "fixed",
      fixedCategoryId: s.fun,
      fixedRta: false,
      namesCategory: true,
      learn: [],
    });
    const failing = db.insert(changeLog).values({
      id: crypto.randomUUID(),
      budgetId: s.bid,
      actor: null as never,
      action: "create",
      entityType: "x",
      entityId: "x",
      createdAt: "x",
    });
    const cols = () =>
      env.DB.prepare(
        "select category_mode, fixed_category_id, fixed_inflow_to_ready_to_assign, default_category_id, updated_at from payees where id = ?",
      )
        .bind(id)
        .first<Json>();
    const before = await cols();
    await expect(db.batch([...stmts, failing] as never)).rejects.toThrow(/NOT NULL|constraint/i);
    expect(await cols()).toEqual(before);
    expect(await s.payeeLogs(id)).toHaveLength(0);
  });
});
