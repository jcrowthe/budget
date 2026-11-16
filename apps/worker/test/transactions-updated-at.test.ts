import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as txRepo from "../src/repositories/transactions";
import { createBudget } from "../src/services/budgets";
import { authed, call, json } from "./helpers";
import { mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
const sleep = () => new Promise((r) => setTimeout(r, 5));

async function account(bid: string) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type: "checking",
    balance: 100000,
    date: DAY,
  });
  return ((await res.json()) as Json).data.account.id as string;
}
const list = async (bid: string, aid: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions`)).json()) as Json).data
    .transactions as Json[];

describe("transactions.updated_at is a stored column", () => {
  it("is set by every writer, and REST and MCP agree", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const start = (await list(bid, aid))[0];
    expect(start.updated_at).toBe(start.created_at);

    const created = (
      (await (
        await send(`/api/v1/budgets/${bid}/transactions`, "POST", {
          account_id: aid,
          date: DAY,
          amount: -1000,
        })
      ).json()) as Json
    ).data.transaction;
    expect(created.updated_at).toBe(created.created_at);

    let prev = created.updated_at as string;
    for (const body of [{ amount: -2000 }, { cleared: "cleared" }]) {
      await sleep();
      const t0 = new Date().toISOString();
      const res = await send(`/api/v1/budgets/${bid}/transactions/${created.id}`, "PATCH", body);
      const t1 = new Date().toISOString();
      const at = ((await res.json()) as Json).data.transaction.updated_at as string;
      expect(at >= t0 && at <= t1).toBe(true);
      expect(at > prev).toBe(true);
      prev = at;
    }

    const one = (
      (await (await json(`/api/v1/budgets/${bid}/transactions/${created.id}`)).json()) as Json
    ).data.transaction;
    const inList = (await list(bid, aid)).find((t) => t.id === created.id);
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const m = (
      await mcpRpc(
        "tools/call",
        { name: "list_transactions", arguments: { budget_id: bid, account_id: aid } },
        2,
      )
    ).body as Json;
    const viaMcp = m.result.structuredContent.transactions.find((t: Json) => t.id === created.id);
    expect(inList).toEqual(one);
    expect(viaMcp).toEqual(one);
    expect(one.updated_at).toBe(prev);

    await sleep();
    const del = (
      (await (
        await send(`/api/v1/budgets/${bid}/transactions/${created.id}`, "DELETE")
      ).json()) as Json
    ).data.transaction;
    const row = await env.DB.prepare("select updated_at, deleted_at from transactions where id = ?")
      .bind(created.id)
      .first<{ updated_at: string; deleted_at: string }>();
    expect(row?.deleted_at).toBeTruthy();
    expect(row?.updated_at).toBe(row?.deleted_at);
    expect(del.updated_at).toBe(row?.updated_at);
    expect(del.updated_at > prev).toBe(true);
  });

  it("reads no change_log row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const seen: string[] = [];
    const spy = new Proxy(env.DB, {
      get: (t, p) => {
        if (p === "prepare")
          return (q: string) => {
            seen.push(q);
            return t.prepare(q);
          };
        const v = Reflect.get(t, p);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    for (const path of [
      `/api/v1/budgets/${bid}/accounts/${aid}/transactions`,
      `/api/v1/budgets/${bid}/transactions`,
    ]) {
      seen.length = 0;
      const res = await call(path, await authed(), { DB: spy });
      expect(res.status).toBe(200);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((q) => /change_log/.test(q))).toEqual([]);
    }
    expect("lastChangedAt" in txRepo).toBe(false);
  });

  it("backfills from the newest history row, else created_at", async () => {
    const bid = await plan();
    const other = await plan();
    const aid = await account(bid);
    const created = "2026-01-01T00:00:00.000Z";
    const at = (h: string) => `2026-01-01T${h}:00:00.000Z`;
    const cases: [string, string[]][] = [
      ["none", []],
      ["one", [at("01")]],
      ["three", [at("01"), at("03"), at("02")]],
      ["older", ["2025-12-31T00:00:00.000Z"]],
    ];
    const ids: string[] = [];
    for (const [, logs] of cases) {
      const id = crypto.randomUUID();
      ids.push(id);
      await env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, created_at, updated_at) values (?, ?, ?, ?, 1, ?, '')",
      )
        .bind(id, bid, aid, DAY, created)
        .run();
      for (const l of logs) {
        await env.DB.prepare(
          "insert into change_log (id, budget_id, actor, action, entity_type, entity_id, created_at) values (?, ?, 'x', 'update', 'transaction', ?, ?)",
        )
          .bind(crypto.randomUUID(), bid, id, l)
          .run();
      }
    }
    // Another plan's history under the same entity id is ignored.
    await env.DB.prepare(
      "insert into change_log (id, budget_id, actor, action, entity_type, entity_id, created_at) values (?, ?, 'x', 'update', 'transaction', ?, ?)",
    )
      .bind(crypto.randomUUID(), other, ids[0], at("09"))
      .run();

    const migration = env.TEST_MIGRATIONS.find((m) =>
      m.name.endsWith("_transactions_updated_at.sql"),
    );
    const update = migration?.queries.find((q) => q.trim().startsWith("UPDATE"));
    expect(update).toBeTruthy();
    await env.DB.exec((update as string).replace(/\s*\n\s*/g, " "));

    const got = [];
    for (const id of ids) {
      got.push(
        (
          await env.DB.prepare("select updated_at from transactions where id = ?")
            .bind(id)
            .first<{ updated_at: string }>()
        )?.updated_at,
      );
    }
    const old = (logs: string[]) => {
      const max = logs.reduce((m, l) => (l > m ? l : m), "");
      return max > created ? max : created;
    };
    expect(got).toEqual(cases.map(([, logs]) => old(logs)));
    expect(got).toEqual([created, at("01"), at("03"), created]);
    const empty = await env.DB.prepare(
      "select count(*) n from transactions where budget_id = ? and updated_at = ''",
    )
      .bind(bid)
      .first<{ n: number }>();
    expect(empty?.n).toBe(0);
  });
});
