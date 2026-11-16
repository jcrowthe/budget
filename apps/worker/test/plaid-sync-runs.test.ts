import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduled } from "../src/scheduled";
import { runSync } from "../src/services/plaid-sync";
import { json } from "./helpers";
import {
  ALL_SENTINELS,
  type FeedPage,
  plaidError,
  plaidTxn,
  SENTINEL,
  syncPages,
} from "./plaid-stub";
import {
  A,
  clean,
  connRow,
  count,
  data,
  failingBatchEnv,
  feed,
  hand,
  imports,
  type Json,
  logCount,
  planCalls,
  q,
  rows,
  setupPlaid,
  stubBank,
  syncOne,
  T,
  world,
  world1,
} from "./plaid-sync-helpers";
import { mcpRpc } from "./surface";

beforeEach(setupPlaid);

const many = (n: number, prefix: string, from = 0) =>
  Array.from({ length: n }, (_, i) =>
    plaidTxn({
      transaction_id: `${prefix}${String(from + i).padStart(4, "0")}`,
      amount: 1 + (from + i) / 100,
      name: `ZZ Shop ${from + i}`,
    }),
  );

async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

describe("sync runs (EXF-462)", () => {
  it("462-8: the schedule syncs connections never synced or not synced for 6 hours, and no other", async () => {
    stubBank();
    const make = async (lastSyncedAgoMs: number | null, status = "connected") => {
      const w = await world();
      await env.DB.prepare(
        "update bank_connections set last_synced_at = ?, status = ? where id = ?",
      )
        .bind(
          lastSyncedAgoMs === null ? null : new Date(Date.now() - lastSyncedAgoMs).toISOString(),
          status,
          w.conn,
        )
        .run();
      return w.conn;
    };
    const H = 3600_000;
    const never = await make(null);
    const old = await make(7 * H);
    const recent = await make(1 * H);
    const repair = await make(null, "login_required");
    const before = Object.fromEntries(
      await Promise.all(
        [never, old, recent, repair].map(async (c) => [c, (await connRow(c)).last_synced_at]),
      ),
    );
    await scheduled({} as ScheduledController, env, {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext);
    const after = async (c: string) => (await connRow(c)).last_synced_at;
    expect(await after(never)).not.toBeNull();
    expect(await after(old)).not.toBe(before[old]);
    expect(await after(recent)).toBe(before[recent]);
    expect(await after(repair)).toBeNull();
  });

  it("462-10: sync_bank_connections with and without bank_connection_id gives the same counts", async () => {
    stubBank();
    const entries = [
      plaidTxn({ transaction_id: "ZZ-T1" }),
      plaidTxn({ transaction_id: "ZZ-T2", amount: 3 }),
    ];
    feed.pages = [{ added: entries }];
    const a = await world1();
    const b = await world1();
    const one = (
      await tool("sync_bank_connections", { budget_id: a.plan, bank_connection_id: a.conn })
    ).structuredContent as Json;
    const all = (await tool("sync_bank_connections", { budget_id: b.plan }))
      .structuredContent as Json;
    expect(one).toMatchObject({ added: 2, status: "connected" });
    expect(all.results).toHaveLength(1);
    const pick = ({ added, matched, modified, removed, skipped, has_more, status }: Json) => ({
      added,
      matched,
      modified,
      removed,
      skipped,
      has_more,
      status,
    });
    expect(pick(all.results[0])).toEqual(pick(one));
    expect(
      await count(
        "select count(*) n from change_log where actor = 'mcp:user:tester@localhost' and entity_type = 'transaction' and budget_id = ?",
        a.plan,
      ),
    ).toBe(0);
    // the route for the plan
    const res = await json(`/api/v1/budgets/${a.plan}/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await data(res)).results[0]).toMatchObject({ added: 0 });
  });

  it("462-11: a failed batch in the middle loses nothing and duplicates nothing on the next run", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    feed.pages = [{ added: many(40, "ZZ-F") }];
    await expect(runSync(failingBatchEnv(2), conn)).rejects.toThrow("simulated");
    expect((await connRow(conn)).sync_cursor).toBeNull();
    const partial = (await imports(account)).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(40);
    const r = await runSync(env, conn);
    expect(r.added).toBe(40 - partial);
    expect(await imports(account)).toHaveLength(40);
    expect((await connRow(conn)).sync_cursor).toBe("c1");
    expect(
      await count(
        "select count(*) n from change_log where budget_id = ? and entity_type = 'transaction' and action = 'create'",
        plan,
      ),
    ).toBe(41); // the Starting Balance and the 40 imports
    expect(
      await count(
        "select count(*) n from (select import_id from transactions where import_id is not null and deleted_at is null group by budget_id, import_id having count(*) > 1)",
      ),
    ).toBe(0);
    // and another repeat changes nothing, history included
    const logs = await logCount();
    await env.DB.prepare("update bank_connections set sync_cursor = null where id = ?")
      .bind(conn)
      .run();
    expect((await runSync(env, conn)).added).toBe(0);
    expect(await logCount()).toBe(logs);
  });

  it("462-12: two requests at the same moment make one run", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = syncPages(() => feed.pages);
    const calls = stubBank({
      "/transactions/sync": async (body) => {
        await gate;
        return inner(body);
      },
    });
    const { plan, conn } = await world1();
    feed.pages = [{ added: many(3, "ZZ-P") }];
    const both = Promise.all([syncOne(plan, conn), syncOne(plan, conn)]);
    await new Promise((r) => setTimeout(r, 100));
    release();
    const [x, y] = await both;
    expect(planCalls(calls, "/transactions/sync")).toHaveLength(1);
    expect(x).toEqual(y);
    expect(x.added).toBe(3);
  });

  it("462-24: a bounded run stops, saves its cursor and the next run continues", async () => {
    stubBank();
    const { plan, conn, account } = await world1();
    const pages: FeedPage[] = [0, 1, 2, 3, 4, 5].map((p) => ({
      added: many(100, "ZZ-B", p * 100),
    }));
    feed.pages = pages;
    const r1 = await syncOne(plan, conn);
    expect(r1).toMatchObject({ added: 400, has_more: true });
    expect(await connRow(conn)).toMatchObject({ sync_cursor: "c4", sync_loop_cursor: "" });
    const r2 = await syncOne(plan, conn);
    expect(r2).toMatchObject({ added: 200, has_more: false });
    expect(await imports(account)).toHaveLength(600);
    expect(await connRow(conn)).toMatchObject({ sync_cursor: "c6", sync_loop_cursor: null });
  });

  it("462-24 variant: a mutation error in the second run restarts from the loop's start, each row once", async () => {
    const pages: FeedPage[] = [0, 1, 2, 3, 4, 5].map((p) => ({
      added: many(100, "ZZ-V", p * 100),
    }));
    feed.pages = pages;
    const inner = syncPages(() => feed.pages);
    let failed = false;
    const calls = stubBank({
      "/transactions/sync": (body) => {
        if (body.cursor === "c4" && !failed) {
          failed = true;
          return plaidError(400, "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
        }
        return inner(body);
      },
    });
    const { plan, conn, account } = await world1();
    await syncOne(plan, conn);
    calls.length = 0;
    const r2 = await syncOne(plan, conn);
    const sent = planCalls(calls, "/transactions/sync").map(
      (c) => (c as unknown as { body: Json }).body.cursor,
    );
    expect(sent[0]).toBe("c4");
    expect(sent[1]).toBeUndefined(); // the loop began at the start of the feed
    // the restart re-reads from the start; four pages is the cap of a run, so one more run finishes
    expect(r2.has_more).toBe(true);
    expect(await connRow(conn)).toMatchObject({ sync_cursor: "c4", sync_loop_cursor: "" });
    const r3 = await syncOne(plan, conn);
    expect(r3.has_more).toBe(false);
    const ids = (await imports(account)).map((x) => x.import_id);
    expect(ids).toHaveLength(600);
    expect(new Set(ids).size).toBe(600);
  });

  it("462-24: the schedule does both runs of the same feed", async () => {
    stubBank();
    const { account, conn } = await world1();
    feed.pages = [0, 1, 2, 3, 4, 5].map((p) => ({ added: many(100, "ZZ-S", p * 100) }));
    await env.DB.prepare("update bank_connections set last_synced_at = null where id = ?")
      .bind(conn)
      .run();
    await scheduled({} as ScheduledController, env, {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext);
    expect(await imports(account)).toHaveLength(600);
    expect((await connRow(conn)).sync_cursor).toBe("c6");
  });

  it("(Lead) the plan's figures equal the same transactions entered by hand", async () => {
    stubBank();
    const { plan: pa, conn, account: acctA } = await world1();
    // plan B: a manual checking account with the same Starting Balance, the same rows by hand
    const pb = (
      await data(
        await json(
          "/api/v1/budgets",
          { method: "POST" },
          { name: `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}` },
        ),
      )
    ).budget.id as string;
    const acctB = (
      await data(
        await json(
          A(pb),
          { method: "POST" },
          { name: "ZZ Checking", type: "checking", balance: 1250500, date: T },
        ),
      )
    ).account.id as string;
    const catOf = async (plan: string) =>
      (await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`))).groups.flatMap(
        (g: Json) => g.categories,
      )[0].id as string;
    const [ca, cb] = [await catOf(pa), await catOf(pb)];
    for (const [plan, account, cat] of [
      [pa, acctA, ca],
      [pb, acctB, cb],
    ] as const) {
      expect(
        (
          await hand(plan, {
            account_id: account,
            date: T,
            amount: -1000,
            payee_name: "ZZ Cafe",
            category_id: cat,
          })
        ).status,
      ).toBe(201);
    }
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-1", amount: 12.34, date: "2026-03-11", name: "ZZ Other" }),
          plaidTxn({ transaction_id: "ZZ-2", amount: -50, date: "2026-03-12", name: "ZZ Pay" }),
          plaidTxn({
            transaction_id: "ZZ-3",
            amount: 4.5,
            date: "2026-03-13",
            name: "ZZ CAFE 9",
            merchant_name: "ZZ Cafe",
          }),
        ],
      },
    ];
    await syncOne(pa, conn);
    expect(await imports(acctA)).toHaveLength(3);
    for (const x of [
      { date: "2026-03-11", amount: -12340, payee_name: "ZZ Other" },
      { date: "2026-03-12", amount: 50000, payee_name: "ZZ Pay", inflow_to_ready_to_assign: true },
      { date: "2026-03-13", amount: -4500, payee_name: "ZZ Cafe", category_id: cb },
    ]) {
      expect((await hand(pb, { account_id: acctB, cleared: "cleared", ...x })).status).toBe(201);
    }
    const balance = async (plan: string, id: string) => {
      const a = (await data(await json(`${A(plan)}/${id}`))).account as Json;
      return [a.cleared_balance, a.uncleared_balance, a.balance];
    };
    expect(await balance(pa, acctA)).toEqual(await balance(pb, acctB));
    const figures = async (plan: string) => {
      const m = (await data(await json(`/api/v1/budgets/${plan}/months/2026-03-01`))) as Json;
      return {
        ready_to_assign: m.ready_to_assign,
        rta: m.rta_breakdown,
        uncategorized: m.uncategorized,
        categories: m.groups.flatMap((g: Json) =>
          g.categories.map((c: Json) => [c.name, c.activity, c.available]),
        ),
      };
    };
    expect(await figures(pa)).toEqual(await figures(pb));
  });

  it("(Lead) no token in a response, a log line or change_log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    stubBank();
    const { plan, conn } = await world1();
    const seen: string[] = [];
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-OK" })] }];
    seen.push(JSON.stringify(await syncOne(plan, conn)));
    for (const h of [
      () => plaidError(400, "ITEM_LOGIN_REQUIRED"),
      () => plaidError(500, "INTERNAL_SERVER_ERROR"),
      () => {
        throw new Error(`network ${SENTINEL.accessToken}`);
      },
    ]) {
      await env.DB.prepare("update bank_connections set status = 'connected' where id = ?")
        .bind(conn)
        .run();
      stubBank({ "/transactions/sync": h });
      seen.push(JSON.stringify(await syncOne(plan, conn)));
    }
    await env.DB.prepare("update bank_connections set status = 'connected' where id = ?")
      .bind(conn)
      .run();
    stubBank({ "/transactions/sync": h500 });
    const res = await json(`/api/v1/bank-connections/${conn}/sync?budget_id=${plan}`, {
      method: "POST",
    });
    seen.push(await res.text());
    seen.push(
      JSON.stringify((await tool("sync_bank_connections", { budget_id: plan })).structuredContent),
    );
    for (const s of spies) for (const c of s.mock.calls) seen.push(JSON.stringify(c.map(String)));
    seen.push(JSON.stringify((await q("select * from change_log")) as Json[]));
    seen.push(JSON.stringify((await q("select * from bank_connections")) as Json[]));
    for (const text of seen) {
      for (const s of ALL_SENTINELS) expect(text.includes(s)).toBe(false);
      expect(clean(text)).toBe(true);
    }
  });
});

const h500 = () => plaidError(500, "INTERNAL_SERVER_ERROR");
