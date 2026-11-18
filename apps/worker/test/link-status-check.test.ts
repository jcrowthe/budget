import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { type requestSync, runSync, syncDueConnections } from "../src/services/plaid-sync";
import { json } from "./helpers";
import { plaidError, plaidTxn } from "./plaid-stub";
import {
  connRow,
  feed,
  imports,
  logCount,
  planCalls,
  q,
  setupPlaid,
  stubBank,
  world1,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

const H = 3600_000;
type Run = typeof requestSync;
/** The nightly loop's own run, without the Durable Object: the same `runSync` with the same options. */
const run = ((e: typeof env, conn: { id: string }, o?: { check?: boolean }) =>
  runSync(e, conn.id, o)) as unknown as Run;
const nightly = (now: Date, opts: { maxRuns?: number } = {}) =>
  syncDueConnections(env, now, run, opts);

/** A world whose connection needs a sign-in since an hour ago, last synced two days ago. */
async function locked() {
  const w = await world1();
  await q(
    "update bank_connections set status = 'login_required', sync_error_since = ?, last_synced_at = ? where id = ?",
    new Date(Date.now() - H).toISOString(),
    new Date(Date.now() - 48 * H).toISOString(),
    w.conn,
  );
  return w;
}
/** Storage lasts through the file: every connection but these is set aside (broken, so neither synced nor checked). */
const setAside = (...keep: string[]) =>
  q(
    `update bank_connections set status = 'broken' where id not in (${keep.map(() => "?").join(",")})`,
    ...keep,
  );
const refuse = { "/transactions/sync": () => plaidError(400, "ITEM_LOGIN_REQUIRED") };

describe("the nightly check of a connection that needs a sign-in (EXF-866)", () => {
  it("a good answer heals it and imports its entries", async () => {
    const calls = stubBank();
    const w = await locked();
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-HEAL" })] }];
    const logs = await logCount("bank_connection");
    calls.length = 0;
    await nightly(new Date());
    const row = await connRow(w.conn);
    expect(row.status).toBe("connected");
    expect(row.sync_error_since).toBeNull();
    expect(row.sync_error_code).toBeNull();
    expect(await imports(w.account)).toHaveLength(1);
    expect(await logCount("bank_connection")).toBe(logs + 1);
    // one /accounts/get: the check's, reused by the sync
    expect(planCalls(calls, "/accounts/get")).toHaveLength(1);
  });

  it("a refusal is one Plaid call, changes nothing but its time, and is not repeated within a day", async () => {
    stubBank();
    const w = await locked();
    const calls = stubBank({
      "/accounts/get": () => plaidError(400, "ITEM_LOGIN_REQUIRED"),
      ...refuse,
    });
    await setAside(w.conn);
    const before = await connRow(w.conn);
    const logs = await logCount();
    calls.length = 0;
    const now = new Date();
    await nightly(now);
    expect(calls).toHaveLength(1);
    const row = await connRow(w.conn);
    expect(row.status).toBe("login_required");
    expect(row.sync_error_since).toBe(before.sync_error_since);
    expect(row.last_synced_at).toBe(before.last_synced_at);
    expect(row.updated_at).toBe(before.updated_at);
    expect(row.login_checked_at).not.toBeNull();
    expect(await logCount()).toBe(logs);
    await nightly(new Date(now.getTime() + 1 * H));
    expect(calls).toHaveLength(1);
    await nightly(new Date(now.getTime() + 21 * H));
    expect(calls).toHaveLength(2);
  });

  it("a broken connection is never checked, and Sync Now on one that needs a sign-in sends nothing", async () => {
    const calls = stubBank();
    const w = await locked();
    await q("update bank_connections set status = 'broken' where id = ?", w.conn);
    calls.length = 0;
    await nightly(new Date());
    expect(calls).toHaveLength(0);
    await q("update bank_connections set status = 'login_required' where id = ?", w.conn);
    const res = await json(`/api/v1/bank-connections/${w.conn}/sync?budget_id=${w.plan}`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect((await connRow(w.conn)).status).toBe("login_required");
  });

  it("the healthy connections come first: with two runs left for two due ones, no check is made", async () => {
    const calls = stubBank();
    const a = await world1();
    const b = await world1();
    await q(
      "update bank_connections set last_synced_at = ? where id in (?, ?)",
      null,
      a.conn,
      b.conn,
    );
    const dead = await locked();
    await setAside(a.conn, b.conn, dead.conn);
    calls.length = 0;
    const out = await nightly(new Date(), { maxRuns: 2 });
    expect(out.map((r) => r.bank_connection_id).sort()).toEqual([a.conn, b.conn].sort());
    expect((await connRow(dead.conn)).status).toBe("login_required");
    expect((await connRow(dead.conn)).login_checked_at).toBeNull();
    // with a third run the check is made
    await q(
      "update bank_connections set last_synced_at = ? where id in (?, ?)",
      null,
      a.conn,
      b.conn,
    );
    const more = await nightly(new Date(), { maxRuns: 3 });
    expect(more.map((r) => r.bank_connection_id)).toContain(dead.conn);
  });

  it("through the Durable Object the check is asked for the same way", async () => {
    stubBank();
    const w = await locked();
    await setAside(w.conn);
    await syncDueConnections(env, new Date());
    expect((await connRow(w.conn)).status).toBe("connected");
  });
});
