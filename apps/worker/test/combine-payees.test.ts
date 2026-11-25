import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import * as payeesRepo from "../src/repositories/payees";
import { buildPayeeCombineBatch } from "../src/services/payees";
import { data, send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { addRule, RR } from "./rename-rules-helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";
import { counts, fingerprint, setOf } from "./undo-helpers";

const q = async (sql: string, ...args: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...args)
      .all<Json>()
  ).results;

const combine = (bid: string, body: Json) => send(`${P(bid)}/combine`, "POST", body);

const register = async (w: Awaited<ReturnType<typeof payeeWorld>>) =>
  (await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET")))
    .transactions as Json[];

/** The change_log rows of one change set, by entity type and action. */
const setRows = (bid: string, set: string, type: string, action: string) =>
  q(
    "select entity_id, before_json, after_json from change_log where budget_id = ? and change_set_id = ? and entity_type = ? and action = ? order by rowid",
    bid,
    set,
    type,
    action,
  );

/** A: 3 transactions, B: 2. */
async function ab() {
  const w = await payeeWorld();
  for (let i = 0; i < 3; i++) await w.tx("ZZ-TEST A");
  for (let i = 0; i < 2; i++) await w.tx("ZZ-TEST B");
  const [a, b] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B")];
  return { ...w, a, b };
}

describe("combine payees (EXF-512)", () => {
  it("AC2: rows move to the survivor under the new name", async () => {
    const w = await ab();
    const res = await combine(w.bid, {
      payee_ids: [w.a, w.b],
      name: "ZZ-TEST AB",
      target_payee_id: w.a,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.payee).toMatchObject({ id: w.a, name: "ZZ-TEST AB", transaction_count: 5 });
    expect(d.merged).toEqual([
      {
        id: w.b,
        name: "ZZ-TEST B",
        replacement_payee_id: w.a,
        transactions_moved: 2,
        scheduled_moved: 0,
      },
    ]);
    const list = await w.list();
    expect(list.some((p) => p.id === w.b)).toBe(false);
    expect(list.filter((p) => p.name === "ZZ-TEST AB")).toHaveLength(1);
    const rows = await q(
      "select payee_id, payee_name from transactions where budget_id = ? and payee_id in (?, ?)",
      w.bid,
      w.a,
      w.b,
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.payee_id).toBe(w.a);
    // The moved rows are stored under the new name (a rename leaves the survivor's own stored names to the join).
    expect(rows.filter((r) => r.payee_name === "ZZ-TEST AB").length).toBeGreaterThanOrEqual(2);
    const reg = await register(w);
    expect(reg.filter((t) => t.payee_name === "ZZ-TEST AB")).toHaveLength(5);
  });

  it("a split line that names a merged payee moves", async () => {
    const w = await ab();
    await w.tx("ZZ-TEST X", {
      amount: -3000,
      subtransactions: [
        { amount: -1000, payee_name: "ZZ-TEST B" },
        { amount: -2000, payee_name: "ZZ-TEST X" },
      ],
    });
    const res = await combine(w.bid, { payee_ids: [w.a, w.b], name: "ZZ-TEST AB" });
    expect(res.status).toBe(200);
    expect((await data(res)).payee.transaction_count).toBe(6);
    const lines = await q(
      "select payee_id, payee_name from transactions where budget_id = ? and parent_transaction_id is not null",
      w.bid,
    );
    expect(lines.filter((l) => l.payee_id === w.a && l.payee_name === "ZZ-TEST AB")).toHaveLength(
      1,
    );
  });

  it("AC5: a schedule moves and its payee is deleted", async () => {
    const w = await payeeWorld();
    await w.tx("ZZ-TEST A");
    await w.sched("ZZ-TEST B");
    const [a, b] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B")];
    const res = await combine(w.bid, { payee_ids: [a, b], name: "ZZ-TEST AB" });
    expect(res.status).toBe(200);
    const s = await q(
      "select payee_id from scheduled_transactions where budget_id = ? and deleted_at is null",
      w.bid,
    );
    expect(s).toEqual([{ payee_id: a }]);
    expect((await w.list()).some((p) => p.id === b)).toBe(false);
  });

  it("AC3: rules move and are deduped by kind and folded text", async () => {
    const w = await payeeWorld();
    for (const n of ["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]) await w.tx(n);
    const [a, b, c] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B"), await w.id("ZZ-TEST C")];
    await addRule(w.bid, a, "contains", "zzx");
    await addRule(w.bid, b, "contains", "ZZX");
    await addRule(w.bid, b, "is", "zz b");
    await addRule(w.bid, c, "is", "zz b");
    const res = await combine(w.bid, {
      payee_ids: [a, b, c],
      name: "ZZ-TEST ABC",
      target_payee_id: a,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.rules_moved).toBe(1);
    expect(d.rules_dropped).toBe(2);
    expect(d.payee.has_rules).toBe(true);
    const rules = await q(
      "select payee_id, kind, match_text from payee_rename_rules where budget_id = ? and deleted_at is null order by kind, match_text",
      w.bid,
    );
    expect(rules).toEqual([
      { payee_id: a, kind: "contains", match_text: "zzx" },
      { payee_id: a, kind: "is", match_text: "zz b" },
    ]);
    const listed = (await data(await send(RR(w.bid, a), "GET"))).rules as Json[];
    expect(listed.map((r) => `${r.kind} ${r.text.toLowerCase()}`).sort()).toEqual([
      "contains zzx",
      "is zz b",
    ]);
  });

  it("AC4: the survivor keeps its categorization", async () => {
    const w = await ab();
    const group = (
      await data(
        await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ-TEST G" }),
      )
    ).category_group.id as string;
    const mk = async (name: string) =>
      (
        await data(
          await send(`/api/v1/budgets/${w.bid}/categories`, "POST", { group_id: group, name }),
        )
      ).category.id as string;
    const [x, y] = [await mk("ZZ-TEST X"), await mk("ZZ-TEST Y")];
    expect(
      (
        await send(`${P(w.bid)}/${w.a}`, "PATCH", {
          category_mode: "fixed",
          fixed_category_id: x,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(`${P(w.bid)}/${w.b}`, "PATCH", {
          category_mode: "fixed",
          fixed_category_id: y,
        })
      ).status,
    ).toBe(200);
    const before = (await w.list()).find((p) => p.id === w.a) as Json;
    const res = await combine(w.bid, {
      payee_ids: [w.a, w.b],
      name: "ZZ-TEST AB",
      target_payee_id: w.a,
    });
    expect(res.status).toBe(200);
    const after = (await data(res)).payee;
    for (const k of [
      "category_mode",
      "fixed_category_id",
      "default_category_id",
      "default_inflow_to_ready_to_assign",
    ]) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.category_mode).toBe("fixed");
    expect(after.default_category_id).toBe(x);
  });

  it("D1: the survivor is the target, else the payee named so, else the first", async () => {
    let w = await ab();
    let res = await combine(w.bid, { payee_ids: [w.a, w.b], name: "ZZ-TEST B" });
    expect(res.status).toBe(200);
    expect((await data(res)).payee).toMatchObject({ id: w.b, name: "ZZ-TEST B" });
    expect(
      await q(
        "select id from change_log where budget_id = ? and entity_type = 'payee' and action = 'update'",
        w.bid,
      ),
    ).toHaveLength(0);

    w = await ab();
    res = await combine(w.bid, { payee_ids: [w.b, w.a], name: "ZZ-TEST NEW" });
    expect((await data(res)).payee).toMatchObject({ id: w.b, name: "ZZ-TEST NEW" });

    w = await ab();
    res = await combine(w.bid, {
      payee_ids: [w.a, w.b],
      name: "ZZ-TEST NEW",
      target_payee_id: w.b,
    });
    expect((await data(res)).payee).toMatchObject({ id: w.b, name: "ZZ-TEST NEW" });

    w = await ab();
    res = await combine(w.bid, {
      payee_ids: [w.a, w.b],
      name: "ZZ-TEST NEW",
      target_payee_id: crypto.randomUUID(),
    });
    expect(res.status).toBe(422);
  });

  it("refusals leave the plan as it was", async () => {
    const w = await ab();
    await w.tx("ZZ-TEST OUT");
    const sys = (
      await q("select id from payees where budget_id = ? and system is not null", w.bid)
    )[0]?.id as string;
    expect(sys).toBeTruthy();
    const unknown = crypto.randomUUID();
    const cases: [Json, number][] = [
      [{ payee_ids: [w.a, `transfer:${w.acct}`], name: "ZZ-TEST N" }, 422],
      [{ payee_ids: [w.a, sys], name: "ZZ-TEST N" }, 422],
      [{ payee_ids: [w.a, unknown], name: "ZZ-TEST N" }, 422],
      [{ payee_ids: [w.a, w.a], name: "ZZ-TEST N" }, 422],
      [{ payee_ids: [w.a, w.b], name: "" }, 422],
      [{ payee_ids: [w.a, w.b], name: "   " }, 422],
      [{ payee_ids: [w.a, w.b], name: "ZZ-TEST OUT" }, 409],
      [{ payee_ids: [w.a, w.b], name: "ZZ-TEST B", target_payee_id: w.a }, 409],
    ];
    const before = [await counts(w.bid), await fingerprint(w.bid)];
    for (const [body, status] of cases) {
      const res = await combine(w.bid, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
    expect([await counts(w.bid), await fingerprint(w.bid)]).toEqual(before);
    expect((await combine(crypto.randomUUID(), { payee_ids: [w.a, w.b], name: "x" })).status).toBe(
      404,
    );
  });

  it("change_log: one change set with a row for every payee, row and rule", async () => {
    const w = await payeeWorld();
    for (let i = 0; i < 2; i++) await w.tx("ZZ-TEST A");
    await w.tx("ZZ-TEST B");
    await w.tx("ZZ-TEST B");
    await w.sched("ZZ-TEST B");
    await w.tx("ZZ-TEST X", {
      amount: -3000,
      subtransactions: [
        { amount: -1000, payee_name: "ZZ-TEST B" },
        { amount: -2000, payee_name: "ZZ-TEST X" },
      ],
    });
    const [a, b] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B")];
    await addRule(w.bid, a, "contains", "zzx");
    await addRule(w.bid, b, "contains", "zzx");
    await addRule(w.bid, b, "is", "zz b");
    const res = await combine(w.bid, { payee_ids: [a, b], name: "ZZ-TEST AB", target_payee_id: a });
    expect(res.status).toBe(200);
    const set = setOf(res);
    const [rename] = await setRows(w.bid, set, "payee", "update");
    expect(rename?.entity_id).toBe(a);
    expect(JSON.parse(rename?.before_json).name).toBe("ZZ-TEST A");
    expect(JSON.parse(rename?.after_json).name).toBe("ZZ-TEST AB");
    const del = await setRows(w.bid, set, "payee", "delete");
    expect(del).toHaveLength(1);
    expect(JSON.parse(del[0]?.after_json)).toMatchObject({
      replacement_payee_id: a,
      transactions_moved: 3,
      scheduled_moved: 1,
    });
    expect(await setRows(w.bid, set, "transaction", "update")).toHaveLength(3);
    expect(await setRows(w.bid, set, "scheduled_transaction", "update")).toHaveLength(1);
    expect(await setRows(w.bid, set, "payee_rename_rule", "update")).toHaveLength(1);
    expect(await setRows(w.bid, set, "payee_rename_rule", "delete")).toHaveLength(1);
  });

  it("is atomic: a failing statement appended leaves everything as it was", async () => {
    const w = await ab();
    await addRule(w.bid, w.b, "is", "zz b");
    const db = getDb(env);
    const [row] = await payeesRepo.listForPlan(db, w.bid, {
      includeHidden: true,
      counts: true,
      ids: [w.a],
    });
    const stmts = buildPayeeCombineBatch(db, {
      budgetId: w.bid,
      actor: "t",
      now: new Date().toISOString(),
      survivor: row as payeesRepo.PayeeListRow,
      mergedIds: [w.b],
      name: "ZZ-TEST AB",
      counts: { [w.b]: { t: 2, s: 0 } },
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
    const before = await fingerprint(w.bid);
    await expect(db.batch([...stmts, failing] as never)).rejects.toThrow(/NOT NULL|constraint/i);
    expect(await fingerprint(w.bid)).toBe(before);
  });

  it("a survivor renamed after the read fails the batch and nothing moves", async () => {
    const w = await ab();
    const db = getDb(env);
    const [row] = await payeesRepo.listForPlan(db, w.bid, {
      includeHidden: true,
      counts: true,
      ids: [w.a],
    });
    await env.DB.prepare("update payees set name = 'ZZ-TEST A2' where id = ?").bind(w.a).run();
    const stmts = buildPayeeCombineBatch(db, {
      budgetId: w.bid,
      actor: "t",
      now: new Date().toISOString(),
      survivor: row as payeesRepo.PayeeListRow,
      mergedIds: [w.b],
      name: "ZZ-TEST AB",
      counts: { [w.b]: { t: 2, s: 0 } },
    });
    const before = await fingerprint(w.bid);
    let err: unknown;
    try {
      await db.batch(stmts as never);
    } catch (e) {
      err = e;
    }
    expect(payeesRepo.isPayeeGone(err)).toBe(true);
    expect(await fingerprint(w.bid)).toBe(before);
  });

  it("the surface lists the route and the tool", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/payees/combine");
    expect(await listedToolNames()).toContain("combine_payees");
  });

  it("REST and MCP agree on twin worlds", async () => {
    const run = async (via: "rest" | "mcp") => {
      const w = await payeeWorld();
      for (let i = 0; i < 2; i++) await w.tx("ZZ-TEST A");
      await w.tx("ZZ-TEST B");
      await w.sched("ZZ-TEST B");
      const [a, b] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B")];
      await addRule(w.bid, b, "is", "zz b");
      const body = { payee_ids: [a, b], name: "ZZ-TEST AB", target_payee_id: a };
      let out: Json;
      if (via === "rest") out = await data(await combine(w.bid, body));
      else {
        await mcpRpc(
          "initialize",
          {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
          1,
        );
        const r = (
          await mcpRpc(
            "tools/call",
            { name: "combine_payees", arguments: { budget_id: w.bid, ...body } },
            2,
          )
        ).body.result as Json;
        expect(r.isError).toBeFalsy();
        out = r.structuredContent;
      }
      const state = await q(
        "select name, deleted_at is null live from payees where budget_id = ? and system is null order by name",
        w.bid,
      );
      const rules = await q(
        "select kind, match_text from payee_rename_rules where budget_id = ? and deleted_at is null",
        w.bid,
      );
      const norm = JSON.parse(
        JSON.stringify({ ...out, payee: { ...out.payee, id: "A" }, merged: out.merged })
          .replaceAll(a, "A")
          .replaceAll(b, "B"),
      );
      return { norm, state, rules };
    };
    expect(await run("mcp")).toEqual(await run("rest"));
  });
});
