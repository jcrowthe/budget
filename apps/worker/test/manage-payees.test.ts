import { env } from "cloudflare:test";
import { PAYEE_ERRORS } from "@budget/schema/payees";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import { buildPayeeDeleteBatch } from "../src/services/payees";
import { DAY, data, send, tool } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { apiPaths, listedToolNames } from "./surface";

const logs = async (type = "payee") =>
  (
    await env.DB.prepare(
      "select actor, action, entity_id, before_json, after_json from change_log where entity_type = ? order by rowid",
    )
      .bind(type)
      .all<Json>()
  ).results;

const body = async (res: Response) => ((await res.json()) as Json).error as Json;

describe("Manage Payees: the worker (EXF-510)", () => {
  it("the surface lists the paths and the tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/payees/{payee_id}",
        "/api/v1/budgets/{budget_id}/payees/bulk",
        "/api/v1/budgets/{budget_id}/payees/{payee_id}/transactions",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "rename_payee",
        "set_payee_hidden",
        "delete_payee",
        "bulk_update_payees",
        "list_payee_transactions",
      ]),
    );
  });

  it("counts: split lines count, deleted rows and rows of a deleted account do not, scheduled rows are apart", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ Counted");
    const split = await w.tx("ZZ Other", {
      amount: -3000,
      subtransactions: [
        { amount: -1000, payee_name: "ZZ Counted" },
        { amount: -2000, payee_name: "ZZ Counted" },
      ],
    });
    const gone = await w.tx("ZZ Counted");
    expect((await send(`/api/v1/budgets/${w.bid}/transactions/${gone.id}`, "DELETE")).status).toBe(
      200,
    );
    await w.sched("ZZ Counted");
    expect(split.id).toBeTruthy();
    const counted = (await w.list()).find((p) => p.name === "ZZ Counted") as Json;
    expect(counted.transaction_count).toBe(3);
    expect(counted.scheduled_count).toBe(1);
    const transfer = (await w.list()).find((p) => p.transfer_account_id) as Json;
    expect([transfer.transaction_count, transfer.scheduled_count]).toEqual([0, 0]);
  });

  it("PATCH: each refusal with its status and words", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ One");
    await w.tx("ZZ Two");
    const one = await w.id("ZZ One");
    const url = (id: string) => `${P(w.bid)}/${id}`;
    let res = await send(url(one), "PATCH", { name: "ZZ Two" });
    expect(res.status).toBe(409);
    expect((await body(res)).detail).toBe(PAYEE_ERRORS.duplicate);
    res = await send(url(one), "PATCH", { name: "   " });
    expect(res.status).toBe(422);
    expect((await body(res)).detail).toBe(PAYEE_ERRORS.empty);
    res = await send(url(one), "PATCH", {});
    expect(res.status).toBe(422);
    const transfer = ((await w.list()).find((p) => p.transfer_account_id) as Json).id;
    res = await send(url(transfer), "PATCH", { name: "X" });
    expect(res.status).toBe(403);
    const sys = ((await w.list()).find((p) => p.system) as Json).id;
    res = await send(url(sys), "PATCH", { hidden: true });
    expect(res.status).toBe(403);
    expect((await send(url("nope"), "PATCH", { name: "X" })).status).toBe(404);
    expect((await send(`${P("nope")}/${one}`, "PATCH", { name: "X" })).status).toBe(404);
  });

  it("PATCH: a case-only rename passes, an unchanged name writes nothing, rename and hide log one row each", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ Cafe");
    const id = await w.id("ZZ Cafe");
    const before = (await logs()).length;
    expect((await send(`${P(w.bid)}/${id}`, "PATCH", { name: "ZZ Cafe" })).status).toBe(200);
    expect((await logs()).length).toBe(before);
    expect((await send(`${P(w.bid)}/${id}`, "PATCH", { name: "zz cafe" })).status).toBe(200);
    const res = await send(`${P(w.bid)}/${id}`, "PATCH", { hidden: true });
    expect(res.status).toBe(200);
    expect((await data(res)).payee.hidden).toBe(true);
    const rows = (await logs()).slice(before);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actor).toBe("user:tester@localhost");
    expect(JSON.parse(rows[0]?.after_json)).toEqual({ id, name: "zz cafe", hidden: false });
    expect(JSON.parse(rows[1]?.before_json)).toEqual({ id, name: "zz cafe", hidden: false });
    expect(JSON.parse(rows[1]?.after_json)).toEqual({ id, name: "zz cafe", hidden: true });
    // The register reads the new name at once, and only this payee changed.
    const reg = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg.map((t) => t.payee_name)).toContain("zz cafe");
  });

  it("delete: unused, with a replacement, with no payee", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    await w.tx("ZZ A");
    await w.tx("ZZ B");
    await w.sched("ZZ A");
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    const gone = await w.tx("ZZ C");
    await send(`/api/v1/budgets/${w.bid}/transactions/${gone.id}`, "DELETE");
    const c = await w.id("ZZ C");
    let res = await send(`${P(w.bid)}/${c}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await data(res)).deleted).toMatchObject({ transactions_moved: 0, scheduled_moved: 0 });
    res = await send(`${P(w.bid)}/${a}?replacement_payee_id=${b}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await data(res)).deleted).toEqual({
      id: a,
      name: "ZZ A",
      replacement_payee_id: b,
      transactions_moved: 2,
      scheduled_moved: 1,
    });
    const reg = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg.filter((t) => t.payee_name === "ZZ B")).toHaveLength(3);
    const sched = (await data(await send(`/api/v1/budgets/${w.bid}/scheduled-transactions`, "GET")))
      .scheduled_transactions as Json[];
    expect(sched[0]?.payee_id).toBe(b);
    expect((await w.list()).some((p) => p.id === a)).toBe(false);
    const del = (await logs()).filter((r) => r.action === "delete" && [a, c].includes(r.entity_id));
    expect(del).toHaveLength(2);
    expect(JSON.parse(del[1]?.after_json)).toEqual({
      id: a,
      deleted: true,
      replacement_payee_id: b,
      transactions_moved: 2,
      scheduled_moved: 1,
    });
    // To no payee.
    res = await send(`${P(w.bid)}/${b}`, "DELETE");
    expect(res.status).toBe(200);
    const reg2 = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg2.filter((t) => t.payee_name?.startsWith("ZZ")).length).toBe(0);
  });

  it("delete and bulk: the refusals", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    await w.tx("ZZ B");
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    const transfer = ((await w.list()).find((p) => p.transfer_account_id) as Json).id;
    const sys = ((await w.list()).find((p) => p.system) as Json).id;
    const del = (id: string, q = "") => send(`${P(w.bid)}/${id}${q}`, "DELETE");
    expect((await del(transfer)).status).toBe(403);
    expect((await del(sys)).status).toBe(403);
    expect((await del("nope")).status).toBe(404);
    for (const r of [transfer, sys, "nope", a]) {
      const res = await del(a, `?replacement_payee_id=${r}`);
      expect(res.status).toBe(422);
    }
    const bulk = (b2: Json) => send(`${P(w.bid)}/bulk`, "POST", b2);
    expect((await bulk({ payee_ids: [a, transfer], action: "hide" })).status).toBe(403);
    expect((await bulk({ payee_ids: [a, "nope"], action: "hide" })).status).toBe(422);
    expect((await bulk({ payee_ids: [], action: "hide" })).status).toBe(422);
    expect((await bulk({ payee_ids: [a], action: "hide", replacement_payee_id: b })).status).toBe(
      422,
    );
    expect(
      (await bulk({ payee_ids: [a, b], action: "delete", replacement_payee_id: a })).status,
    ).toBe(422);
    expect((await bulk({ payee_ids: [a], action: "hide" })).status).toBe(200);
    expect((await w.list()).find((p) => p.id === b)?.hidden).toBe(false);
  });

  it("bulk: hide and unhide log only the rows that change; delete with a replacement", async () => {
    const w = await payeeWorld();
    for (const n of ["ZZ A", "ZZ B", "ZZ C", "ZZ R"]) await w.tx(n);
    const [a, b, c, r] = [
      await w.id("ZZ A"),
      await w.id("ZZ B"),
      await w.id("ZZ C"),
      await w.id("ZZ R"),
    ];
    const bulk = async (b2: Json) => data(await send(`${P(w.bid)}/bulk`, "POST", b2));
    await bulk({ payee_ids: [a], action: "hide" });
    const n0 = (await logs()).length;
    const res = await bulk({ payee_ids: [a, b], action: "hide" });
    expect(res.payees.map((p: Json) => p.hidden)).toEqual([true, true]);
    expect((await logs()).length - n0).toBe(1);
    await bulk({ payee_ids: [a, b], action: "unhide" });
    expect((await w.list()).filter((p) => p.hidden)).toHaveLength(0);
    const out = await bulk({ payee_ids: [a, b, c], action: "delete", replacement_payee_id: r });
    expect(out.deleted.map((d: Json) => d.transactions_moved)).toEqual([1, 1, 1]);
    const reg = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg.filter((t) => t.payee_name === "ZZ R")).toHaveLength(4);
  });

  it("delete is atomic: a failing statement appended leaves everything as it was", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    const a = await w.id("ZZ A");
    const db = getDb(env);
    const stmts = buildPayeeDeleteBatch(db, {
      budgetId: w.bid,
      actor: "t",
      now: new Date().toISOString(),
      ids: [a],
      replacementId: null,
      counts: { [a]: { t: 1, s: 0 } },
    });
    const failing = db.insert(changeLog).values({
      id: crypto.randomUUID(),
      budgetId: w.bid,
      actor: null as never,
      action: "create",
      entityType: "x",
      entityId: "x",
      createdAt: "x",
    });
    await expect(db.batch([...stmts, failing] as never)).rejects.toThrow(/NOT NULL|constraint/i);
    expect((await w.list()).some((p) => p.id === a)).toBe(true);
    const reg = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg[0]?.payee_name).toBe("ZZ A");
    expect((await logs()).filter((r) => r.entity_id === a && r.action === "delete")).toHaveLength(
      0,
    );
  });

  it("the popover read: newest first, split flag, scheduled row, total beyond the limit", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A", { date: "2026-11-01", memo: "old" });
    await w.tx("ZZ A", { date: "2026-11-09", memo: "new" });
    await w.tx("ZZ X", {
      amount: -3000,
      subtransactions: [
        { amount: -1000, payee_name: "ZZ A" },
        { amount: -2000, payee_name: "ZZ A" },
      ],
    });
    await w.tx("ZZ A", {
      amount: -3000,
      date: "2026-11-05",
      subtransactions: [{ amount: -1000 }, { amount: -2000 }],
    });
    await w.sched("ZZ A");
    const a = await w.id("ZZ A");
    const out = await data(await send(`${P(w.bid)}/${a}/transactions`, "GET"));
    const dates = out.transactions.map((t: Json) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(out.transactions[0]).toMatchObject({ kind: "scheduled", account_name: "ZZ Checking" });
    expect(out.transactions.some((t: Json) => t.is_split)).toBe(true);
    expect(out.total_count).toBe(out.transactions.length);
    const sys = ((await w.list()).find((p) => p.system) as Json).id;
    expect((await send(`${P(w.bid)}/${sys}/transactions`, "GET")).status).toBe(403);
    expect((await send(`${P(w.bid)}/nope/transactions`, "GET")).status).toBe(404);
    // 520 rows: the read is cut at 500 and says how many there are.
    const stmts = Array.from({ length: 520 }, (_, i) =>
      env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id) values (?, ?, ?, '2026-01-01', -1, 'cleared', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)",
      ).bind(`zz-bulk-${i}`, w.bid, w.acct, a),
    );
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    const big = await data(await send(`${P(w.bid)}/${a}/transactions`, "GET"));
    expect(big.transactions).toHaveLength(500);
    expect(big.total_count).toBe(out.total_count + 520);
  });

  it("the tools give the same results as the routes", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ A");
    await w.tx("ZZ B");
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    const j = async (name: string, args: Json) => {
      const r = await tool(name, { budget_id: w.bid, ...args });
      return { err: r.isError, out: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
    };
    expect((await j("rename_payee", { payee_id: a, name: "ZZ B" })).out).toBe(
      PAYEE_ERRORS.duplicate,
    );
    expect((await j("rename_payee", { payee_id: a, name: "ZZ A2" })).out.payee.name).toBe("ZZ A2");
    expect((await j("set_payee_hidden", { payee_id: a, hidden: true })).out.payee.hidden).toBe(
      true,
    );
    expect((await j("list_payee_transactions", { payee_id: a })).out.total_count).toBe(1);
    expect(
      (await j("bulk_update_payees", { payee_ids: [a], action: "unhide" })).out.payees[0].hidden,
    ).toBe(false);
    expect(
      (await j("delete_payee", { payee_id: a, replacement_payee_id: b })).out.deleted
        .transactions_moved,
    ).toBe(1);
    expect(
      (await j("bulk_update_payees", { payee_ids: [b], action: "delete" })).out.deleted,
    ).toHaveLength(1);
    expect(DAY).toBeTruthy();
  });
});
