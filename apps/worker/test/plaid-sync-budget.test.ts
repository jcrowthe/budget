import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db/client";
import { bankConnections } from "../src/db/schema/bank-connections";
import { batchCount } from "../src/services/batch-groups";
import { runSync, syncDueConnections } from "../src/services/plaid-sync";
import { CallBudget, CallLimitReached, countedEnv } from "../src/services/sync-budget";
import { json } from "./helpers";
import { type FeedPage, plaidError, plaidTxn, syncPages } from "./plaid-stub";
import {
  budgetWorld,
  clean,
  connRow,
  count,
  data,
  failingBatchEnv,
  feed,
  imports,
  type Json,
  logCount,
  planCalls,
  q,
  runUntilDone,
  setupPlaid,
  stubBank,
  world,
  world1,
} from "./plaid-sync-helpers";
import { mcpRpc } from "./surface";

beforeEach(setupPlaid);

/** The heavy cases import hundreds of rows over several runs. */
const LONG = 60_000;

const many = (n: number, prefix: string, from = 0) =>
  Array.from({ length: n }, (_, i) =>
    plaidTxn({
      transaction_id: `${prefix}${String(from + i).padStart(4, "0")}`,
      amount: 1 + (from + i) / 100,
      name: `ZZ Shop ${from + i}`,
    }),
  );

const sum = (rs: Json[], k: string) => rs.reduce((n, r) => n + (r[k] as number), 0);
const dupes = () =>
  count(
    "select count(*) n from (select import_id from transactions where import_id is not null and deleted_at is null group by budget_id, import_id having count(*) > 1)",
  );

async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

describe("sync budget (EXF-613)", () => {
  it(
    "EXF-613 1: 500 entries with payee history import over several runs, each once",
    async () => {
      stubBank();
      const { conn, account, cat } = await budgetWorld();
      const rs = await runUntilDone(env, conn, {}, 6);
      expect(rs.length).toBeGreaterThanOrEqual(2);
      expect(sum(rs, "added")).toBe(490);
      expect(sum(rs, "matched")).toBe(10);
      const live = await imports(account);
      const matched = await q(
        "select import_id from transactions where account_id = ? and deleted_at is null and import_id is not null and source is null",
        account,
      );
      expect(live.length + matched.length).toBe(500);
      expect(await dupes()).toBe(0);
      expect(
        await count(
          "select count(*) n from change_log where actor = 'service:plaid' and entity_type = 'transaction' and action = 'create'",
        ),
      ).toBe(490);
      expect(
        await count(
          "select count(*) n from change_log where actor = 'service:plaid' and entity_type = 'transaction' and action = 'update'",
        ),
      ).toBe(10);
      expect(live.every((r) => r.category_id === cat)).toBe(true);
      expect((await connRow(conn)).sync_cursor).toBe("c1");
    },
    LONG,
  );

  it(
    "EXF-613 3: a run stopped by the budget keeps its cursors and the next run goes on",
    async () => {
      stubBank();
      const { conn, account } = await budgetWorld();
      const before = await connRow(conn);
      const r1 = await runSync(env, conn, { callBudget: 25 });
      expect(r1.has_more).toBe(true);
      expect(r1.added).toBeGreaterThan(0);
      const after = await connRow(conn);
      for (const k of ["sync_cursor", "sync_loop_cursor", "sync_accounts", "sync_error_since"])
        expect(after[k]).toEqual(before[k]);
      expect(after.status).toBe("connected");
      expect(after.last_synced_at).not.toBeNull();
      const rest = await runUntilDone(env, conn, { callBudget: 25 }, 20);
      expect(sum([r1, ...rest], "added")).toBe(490);
      expect(await imports(account)).toHaveLength(490);
      expect(await dupes()).toBe(0);
      // a repeat from nothing changes nothing
      await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
        .bind(conn)
        .run();
      const n = await logCount();
      const again = await runUntilDone(env, conn, {}, 6);
      expect(sum(again, "added") + sum(again, "matched") + sum(again, "modified")).toBe(0);
      expect(await logCount()).toBe(n);
      expect(await imports(account)).toHaveLength(490);
    },
    LONG,
  );

  it(
    "EXF-613 3 variant: a failed batch in the middle of a stopped run loses nothing",
    async () => {
      stubBank();
      const { conn, account } = await budgetWorld();
      await expect(runSync(failingBatchEnv(5), conn, { callBudget: 25 })).rejects.toThrow(
        "simulated",
      );
      expect((await connRow(conn)).sync_cursor).toBeNull();
      await runUntilDone(env, conn, { callBudget: 25 }, 20);
      expect(await imports(account)).toHaveLength(490);
      expect(await dupes()).toBe(0);
    },
    LONG,
  );

  it("EXF-613 4: a thrown error leaves delayed and sync_failed_at, and the old cursor", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [{ added: many(40, "ZZ-E") }];
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logged.push(JSON.stringify(a)));
    const logsBefore = await logCount("bank_connection");
    await expect(runSync(failingBatchEnv(2), conn)).rejects.toThrow("simulated");
    const one = await data(await json(`/api/v1/bank-connections/${conn}?budget_id=${plan}`));
    expect(one.bank_connection).toMatchObject({ status: "delayed" });
    expect(Number.isNaN(Date.parse(one.bank_connection.sync_failed_at))).toBe(false);
    const list = await data(await json(`/api/v1/bank-connections?budget_id=${plan}`));
    expect(list.bank_connections[0]).toMatchObject({ status: "delayed" });
    expect(list.bank_connections[0].sync_failed_at).toBe(one.bank_connection.sync_failed_at);
    const mcp = await tool("list_bank_connections", { budget_id: plan });
    const first = (mcp.structuredContent as Json).bank_connections[0];
    expect(first).toMatchObject({
      status: "delayed",
      sync_failed_at: one.bank_connection.sync_failed_at,
    });
    const row = await connRow(conn);
    expect(row.sync_cursor).toBeNull();
    expect(row.sync_error_since).toBeNull();
    expect(await logCount("bank_connection")).toBe(logsBefore + 1);
    const text = JSON.stringify([
      one,
      list,
      mcp,
      await q(
        "select before_json, after_json from change_log where entity_type = 'bank_connection'",
      ),
      logged,
    ]);
    expect(clean(text)).toBe(true);
    const r = await runSync(env, conn);
    expect(r.status).toBe("connected");
    expect((await connRow(conn)).sync_failed_at).toBeNull();
    expect(await imports(account)).toHaveLength(40);
  });

  it("EXF-613 4 variant: a conflict at the last batch is visible and keeps the other cursor", async () => {
    stubBank();
    const { conn } = await world1();
    feed.pages = [{ added: many(3, "ZZ-K") }];
    let seen = 0;
    const DB = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return async (stmts: D1PreparedStatement[]) => {
            // batches: context read, unit read, writes, then the final one
            if (++seen === 4)
              await target
                .prepare("update bank_connections set sync_cursor = 'cX' where id = ?")
                .bind(conn)
                .run();
            return target.batch(stmts);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(runSync({ ...env, DB } as typeof env, conn)).rejects.toThrow("sync conflict");
    expect(await connRow(conn)).toMatchObject({ status: "delayed", sync_cursor: "cX" });
    expect((await connRow(conn)).sync_failed_at).not.toBeNull();
  });

  it("EXF-613 4 variant: a connection that needs a repair keeps its status when a run throws", async () => {
    stubBank();
    const { conn } = await world1();
    feed.pages = [{ added: many(3, "ZZ-L") }];
    let seen = 0;
    const DB = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return async (stmts: D1PreparedStatement[]) => {
            if (++seen === 2) {
              await target
                .prepare("update bank_connections set status = 'login_required' where id = ?")
                .bind(conn)
                .run();
              throw new Error("simulated D1 failure");
            }
            return target.batch(stmts);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(runSync({ ...env, DB } as typeof env, conn)).rejects.toThrow("simulated");
    expect(await connRow(conn)).toMatchObject({ status: "login_required", sync_failed_at: null });
  });

  it(
    "EXF-613 8: a page that only removes entries deletes them",
    async () => {
      stubBank();
      const { conn, account } = await world1();
      const list = many(40, "ZZ-X");
      feed.pages = [{ added: list }];
      await runUntilDone(env, conn);
      expect(await imports(account)).toHaveLength(40);
      feed.pages = [{ added: list }, { removed: list.map((t) => t.transaction_id) }];
      const rs = await runUntilDone(env, conn);
      expect(sum(rs, "removed")).toBe(40);
      expect(await imports(account)).toHaveLength(0);
    },
    LONG,
  );

  it(
    "EXF-613 8: removals that span several runs finish",
    async () => {
      stubBank();
      const { conn, account } = await world1();
      const list = many(40, "ZZ-Y");
      feed.pages = [{ added: list }];
      await runUntilDone(env, conn);
      feed.pages = [
        { added: list },
        { added: many(1, "ZZ-Z"), removed: list.map((t) => t.transaction_id) },
      ];
      const rs = await runUntilDone(env, conn, {}, 10);
      expect(rs.length).toBeGreaterThanOrEqual(2);
      expect(rs.at(-1)?.has_more).toBe(false);
      expect(sum(rs, "removed")).toBe(40);
      expect(await imports(account)).toHaveLength(1);
    },
    LONG,
  );

  it(
    "EXF-613 6: a mutation restart after a stop begins at the loop's first cursor",
    async () => {
      const inner = syncPages(() => feed.pages);
      let mutate = false;
      const calls = stubBank({
        "/transactions/sync": (body) => {
          if (mutate && body.cursor === "c4") {
            mutate = false;
            return plaidError(400, "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
          }
          return inner(body);
        },
      });
      const { conn, account } = await world1();
      feed.pages = [
        ...[0, 1, 2, 3].map((p): FeedPage => ({ added: many(100, "ZZ-R", p * 100) })),
        { added: many(900, "ZZ-R", 400) },
      ];
      const r1 = await runSync(env, conn);
      expect(r1.added).toBe(400);
      expect(await connRow(conn)).toMatchObject({ sync_cursor: "c4", sync_loop_cursor: "" });
      const r2 = await runSync(env, conn, { callBudget: 22 });
      expect(r2.has_more).toBe(true);
      expect(r2.added).toBeGreaterThan(0);
      expect(await connRow(conn)).toMatchObject({ sync_cursor: "c4", sync_loop_cursor: "" });
      mutate = true;
      calls.length = 0;
      await runSync(env, conn);
      const sent = planCalls(calls, "/transactions/sync").map((c) => c.body.cursor);
      expect(sent[0]).toBe("c4");
      expect(sent[1]).toBeUndefined();
      await runUntilDone(env, conn, {}, 10);
      const ids = (await imports(account)).map((x) => x.import_id);
      expect(ids).toHaveLength(1300);
      expect(new Set(ids).size).toBe(1300);
    },
    LONG,
  );

  it(
    "EXF-613 7: the schedule runs three due connections round-robin within its caps",
    async () => {
      const calls = stubBank();
      const ws = [await world1(), await world1(), await world1()];
      feed.pages = [{ added: many(900, "ZZ-D") }];
      calls.length = 0;
      const out = await syncDueConnections(env);
      for (const w of ws) {
        const mine = out.filter((r) => r.bank_connection_id === w.conn);
        expect(mine.length).toBeGreaterThanOrEqual(2);
        expect(mine.at(-1)?.has_more).toBe(false);
        expect((await imports(w.account)).length).toBeGreaterThan(0);
      }
      const accountCalls = planCalls(calls, "/accounts/get").length;
      expect(accountCalls).toBeLessThanOrEqual(15);
      expect(accountCalls).toBeLessThanOrEqual(40);
    },
    LONG,
  );

  it("EXF-613 7: the round-robin never asks for more than its caps", async () => {
    stubBank();
    for (let i = 0; i < 9; i++) await world();
    const asked: string[] = [];
    const run = (async (_e: unknown, conn: { id: string }) => {
      asked.push(conn.id);
      return { bank_connection_id: conn.id, has_more: true };
    }) as unknown as typeof import("../src/services/plaid-sync").requestSync;
    await syncDueConnections(env, new Date(), run);
    expect(asked.length).toBe(40);
    const per = new Map<string, number>();
    for (const id of asked) per.set(id, (per.get(id) ?? 0) + 1);
    expect(per.size).toBeGreaterThanOrEqual(9);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(5);
    expect(new Set(asked.slice(0, per.size)).size).toBe(per.size);
    asked.length = 0;
    await syncDueConnections(env, new Date(), (async (_e: unknown, c: { id: string }) => {
      asked.push(c.id);
      return { bank_connection_id: c.id, has_more: false };
    }) as unknown as typeof run);
    expect(asked.length).toBe(per.size);
  });

  it("the counter counts a select, an insert and a batch of three as three calls", async () => {
    const b = new CallBudget();
    const cenv = countedEnv(env, b);
    const db = getDb(cenv);
    await db.select({ one: sql`1` }).from(bankConnections);
    await cenv.DB.prepare("update bank_connections set nickname = nickname where id = ?")
      .bind("none")
      .run();
    await cenv.DB.batch([
      cenv.DB.prepare("select 1"),
      cenv.DB.prepare("select 2"),
      cenv.DB.prepare("select 3"),
    ]);
    expect(b.d1).toBe(3);
    const small = new CallBudget(5, 6);
    for (let i = 0; i < 6; i++) small.charge("d1");
    expect(() => small.charge("d1")).toThrow(CallLimitReached);
    small.failing();
    small.charge("d1");
    expect(() => small.charge("plaid")).toThrow(CallLimitReached);
  });

  it("batchCount mirrors the packing of runGroups", () => {
    expect(batchCount([45, 45, 1])).toBe(2);
    expect(batchCount([100])).toBe(1);
    expect(batchCount([])).toBe(0);
    expect(batchCount([89, 2, 89])).toBe(3);
  });
});
