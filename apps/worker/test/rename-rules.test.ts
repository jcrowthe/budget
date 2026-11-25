import { env } from "cloudflare:test";
import { PAYEE_ERRORS } from "@budget/schema/payees";
import { foldRuleText, pickRenameRule, RENAME_RULE_ERRORS } from "@budget/schema/rename-rules";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import * as rulesRepo from "../src/repositories/payee-rename-rules";
import { buildPayeeDeleteBatch } from "../src/services/payees";
import { data, send, tool } from "./account-helpers";
import { type Json, P } from "./manage-payees-helpers";
import { addRule, liveRules, RR, ruleLogs, rulesWorld } from "./rename-rules-helpers";
import { apiPaths, listedToolNames } from "./surface";

const err = async (res: Response) => ((await res.json()) as Json).error as Json;
const NEW_TOOLS = [
  "list_payee_rename_rules",
  "create_payee_rename_rule",
  "update_payee_rename_rule",
  "delete_payee_rename_rule",
];

describe("payee renaming rules: the operations (EXF-467)", () => {
  it("the surface has the paths and 115 tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/payees/{payee_id}/rename-rules",
        "/api/v1/budgets/{budget_id}/payees/{payee_id}/rename-rules/{rule_id}",
      ]),
    );
    const names = await listedToolNames();
    expect(names).toEqual(expect.arrayContaining(NEW_TOOLS));
    expect(names).toHaveLength(115);
  });

  it("lists, creates, updates and deletes, each with a history row of the actor", async () => {
    const w = await rulesWorld(["ZZ Cafe"]);
    const id = await w.id("ZZ Cafe");
    const created = await send(RR(w.bid, id), "POST", {
      kind: "contains",
      text: "  ZZ  Bank Cafe ",
    });
    expect(created.status).toBe(201);
    const rule = (await data(created)).rule as Json;
    expect(rule).toMatchObject({ payee_id: id, kind: "contains", text: "ZZ  Bank Cafe" });
    expect(
      ((await data(await send(RR(w.bid, id), "GET"))).rules as Json[]).map((r) => r.id),
    ).toEqual([rule.id]);

    const patched = await send(`${RR(w.bid, id)}/${rule.id}`, "PATCH", { kind: "is" });
    expect(patched.status).toBe(200);
    const after = (await data(patched)).rule as Json;
    expect(after).toMatchObject({ id: rule.id, kind: "is", created_at: rule.created_at });

    const del = await send(`${RR(w.bid, id)}/${rule.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect(((await data(del)).rule as Json).id).toBe(rule.id);
    expect(await liveRules(w.bid)).toEqual([]);
    expect(((await data(await send(RR(w.bid, id), "GET"))).rules as Json[]).length).toBe(0);

    const log = await ruleLogs(w.bid);
    expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    expect(log.every((l) => l.actor === "user:tester@localhost" && l.entity_id === rule.id)).toBe(
      true,
    );
    expect(JSON.parse(log[1].before_json)).toMatchObject({ kind: "contains" });
    expect(JSON.parse(log[1].after_json)).toMatchObject({ kind: "is" });
  });

  it("refuses with the words", async () => {
    const w = await rulesWorld(["ZZ Cafe"]);
    const id = await w.id("ZZ Cafe");
    const post = (pid: string, body: Json) => send(RR(w.bid, pid), "POST", body);
    // EXF-885: a transfer payee takes rules now; one of no account of the plan is not found.
    expect((await post("transfer:abc", { kind: "is", text: "x" })).status).toBe(404);
    const system = (await w.list()).find((p) => p.system)?.id;
    if (system) {
      const r = await post(system, { kind: "is", text: "x" });
      expect(r.status).toBe(403);
      expect((await err(r)).detail).toBe(PAYEE_ERRORS.system);
    }
    expect((await post("nope", { kind: "is", text: "x" })).status).toBe(404);
    expect((await send(`${RR(w.bid, id)}/nope`, "DELETE")).status).toBe(404);
    expect((await send(`${RR(w.bid, id)}/nope`, "PATCH", { kind: "is" })).status).toBe(404);

    const blank = await post(id, { kind: "is", text: "  " });
    expect(blank.status).toBe(422);
    expect((await err(blank)).detail).toBe(RENAME_RULE_ERRORS.empty);
    const long = await post(id, { kind: "is", text: "a".repeat(201) });
    expect(long.status).toBe(422);
    expect((await err(long)).detail).toBe(RENAME_RULE_ERRORS.tooLong);
    expect((await post(id, { kind: "like", text: "a" })).status).toBe(422);

    const rule = await addRule(w.bid, id, "is", "zz cafe");
    const dup = await post(id, { kind: "is", text: "ZZ  cafe" });
    expect(dup.status).toBe(409);
    expect((await err(dup)).detail).toBe(RENAME_RULE_ERRORS.duplicate);
    const other = await addRule(w.bid, id, "contains", "zz cafe");
    const toDup = await send(`${RR(w.bid, id)}/${other.id}`, "PATCH", { kind: "is" });
    expect(toDup.status).toBe(409);
    const empty = await send(`${RR(w.bid, id)}/${rule.id}`, "PATCH", {});
    expect(empty.status).toBe(422);
    expect((await err(empty)).detail).toBe(RENAME_RULE_ERRORS.noField);
    const same = await send(`${RR(w.bid, id)}/${rule.id}`, "PATCH", { kind: "is" });
    expect(same.status).toBe(200);
    expect((await ruleLogs(w.bid)).length).toBe(2);
  });

  it("has_rules is on the list, hidden payees included; a deleted rule clears it", async () => {
    const w = await rulesWorld(["ZZ A", "ZZ B"]);
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    const rule = await addRule(w.bid, a, "is", "zz a bank");
    await send(`${P(w.bid)}/${b}`, "PATCH", { hidden: true });
    await addRule(w.bid, b, "contains", "zz b");
    const has = async () =>
      Object.fromEntries(
        (await w.list()).filter((p) => p.name.startsWith("ZZ ")).map((p) => [p.name, p.has_rules]),
      );
    expect(await has()).toEqual({ "ZZ A": true, "ZZ B": true });
    await send(`${RR(w.bid, a)}/${rule.id}`, "DELETE");
    expect(await has()).toEqual({ "ZZ A": false, "ZZ B": true });
  });

  it("the tools do the same with an mcp actor", async () => {
    const w = await rulesWorld(["ZZ Cafe"]);
    const id = await w.id("ZZ Cafe");
    const made = await tool("create_payee_rename_rule", {
      budget_id: w.bid,
      payee_id: id,
      kind: "contains",
      text: "zz mcp",
    });
    const rule = made.structuredContent.rule as Json;
    expect(rule.text).toBe("zz mcp");
    const listed = await tool("list_payee_rename_rules", { budget_id: w.bid, payee_id: id });
    expect(listed.structuredContent.rules).toHaveLength(1);
    const upd = await tool("update_payee_rename_rule", {
      budget_id: w.bid,
      payee_id: id,
      rule_id: rule.id,
      text: "zz mcp two",
    });
    expect(upd.structuredContent.rule.text).toBe("zz mcp two");
    const bad = await tool("create_payee_rename_rule", {
      budget_id: w.bid,
      payee_id: "transfer:x",
      kind: "is",
      text: "x",
    });
    expect(bad.isError).toBe(true);
    await tool("delete_payee_rename_rule", { budget_id: w.bid, payee_id: id, rule_id: rule.id });
    const log = await ruleLogs(w.bid);
    expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    expect(log.every((l) => l.actor.startsWith("mcp:"))).toBe(true);
  });

  it("deleting a payee deletes its rules in the delete's own batch; the replacement inherits none", async () => {
    const w = await rulesWorld(["ZZ A", "ZZ B", "ZZ Repl"]);
    const [a, b, repl] = [await w.id("ZZ A"), await w.id("ZZ B"), await w.id("ZZ Repl")];
    await addRule(w.bid, a, "is", "zz a");
    await addRule(w.bid, b, "contains", "zz b");

    const db = getDb(env);
    const stmts = buildPayeeDeleteBatch(db, {
      budgetId: w.bid,
      actor: "t",
      now: new Date().toISOString(),
      ids: [a],
      replacementId: repl,
      counts: { [a]: { t: 1, s: 0 } },
    });
    expect(stmts).toHaveLength(8);
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
    expect(await liveRules(w.bid)).toHaveLength(2);
    expect((await ruleLogs(w.bid)).filter((l) => l.action === "delete")).toHaveLength(0);

    const one = await send(`${P(w.bid)}/${a}?replacement_payee_id=${repl}`, "DELETE");
    expect(one.status).toBe(200);
    expect((await liveRules(w.bid)).map((r) => r.payee_id)).toEqual([b]);
    const dels = (await ruleLogs(w.bid)).filter((l) => l.action === "delete");
    expect(dels).toHaveLength(1);
    expect(JSON.parse(dels[0].before_json)).toMatchObject({ payee_id: a, text: "zz a" });
    expect((await w.list()).find((p) => p.id === repl)?.has_rules).toBe(false);

    const bulk = await send(`${P(w.bid)}/bulk`, "POST", { payee_ids: [b], action: "delete" });
    expect(bulk.status).toBe(200);
    expect(await liveRules(w.bid)).toEqual([]);
    expect((await ruleLogs(w.bid)).filter((l) => l.action === "delete")).toHaveLength(2);
  });

  it("the SQL conditions agree with pickRenameRule", async () => {
    const w = await rulesWorld(["ZZ A", "ZZ B"]);
    const [a, b] = [await w.id("ZZ A"), await w.id("ZZ B")];
    await addRule(w.bid, a, "contains", "uber eats");
    await addRule(w.bid, a, "contains", "café");
    await addRule(w.bid, a, "is", "ZZ Whole");
    const db = getDb(env);
    const stored = (await liveRules(w.bid)).map((r) => ({
      id: r.id as string,
      payeeId: r.payee_id as string,
      kind: r.kind as "is" | "contains",
      matchText: r.match_text as string,
      createdAt: r.created_at as string,
    }));
    for (const name of [
      "UBER EATS ORDER",
      "EATS UBER",
      "CAFÉ ZZ",
      "Café zz",
      "zz whole",
      "ZZ WHOLE 2",
    ]) {
      const picked = pickRenameRule(
        name,
        stored.filter((r) => r.kind === "contains"),
      );
      const [row] = await db.all<{ x: number }>(
        // biome-ignore lint/style/noNonNullAssertion: a SQL condition
        (await import("drizzle-orm"))
          .sql`select ${rulesRepo.containsMatchSql(w.bid, foldRuleText(name), b)} as x`,
      );
      expect(Number(row?.x) === 1, name).toBe(picked !== null);
    }
    const [h] = await db.all<{ x: number }>(
      (await import("drizzle-orm"))
        .sql`select ${rulesRepo.hasRuleSql(a, "is", foldRuleText("zz  WHOLE"))} as x`,
    );
    expect(Number(h?.x)).toBe(1);
  });
});
