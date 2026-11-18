import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { cronRun } from "../src/scheduled";
import { type requestSync, runSync, syncDueConnections } from "../src/services/plaid-sync";
import { plaidError } from "./plaid-stub";
import { q, setupPlaid, stubBank, world, world1 } from "./plaid-sync-helpers";
import { account, plan, realRows, sched, setNext } from "./scheduled-helpers";

beforeEach(setupPlaid);

type Run = typeof requestSync;
const H = 3600_000;
const noRun = (async () => ({ has_more: false })) as unknown as Run;

describe("the scheduled run, every six hours (EXF-751)", () => {
  it("every six hours: a connection synced by one run is due for the next", async () => {
    stubBank();
    const { conn } = await world();
    await q("update bank_connections set last_synced_at = null where id = ?", conn);
    const ran: string[] = [];
    // The stub ends five seconds after the run began, as a real sync does.
    const run = (async (_e: unknown, c: { id: string }) => {
      ran.push(c.id);
      await q(
        "update bank_connections set last_synced_at = ? where id = ?",
        new Date(at.getTime() + 5000).toISOString(),
        c.id,
      );
      return { has_more: false };
    }) as unknown as Run;
    let at = new Date("2030-03-10T03:00:00Z");
    await syncDueConnections(env, at, run);
    expect(ran.filter((x) => x === conn)).toHaveLength(1);
    at = new Date("2030-03-10T09:00:00Z");
    await syncDueConnections(env, at, run);
    expect(ran.filter((x) => x === conn)).toHaveLength(2);
    at = new Date("2030-03-10T09:10:00Z");
    await syncDueConnections(env, at, run);
    expect(ran.filter((x) => x === conn)).toHaveLength(2);
  });

  it("the scheduler enters each due schedule once per day", async () => {
    const b = await plan();
    const a = await account(b);
    const input = (frequency: string) => ({
      account_id: a,
      date_first: "2030-03-20",
      frequency,
      amount: -100,
      payee_name: "ZZ Payee",
    });
    const daily = (await sched(b, input("daily"))).scheduled_transaction.id as string;
    const monthly = (await sched(b, input("monthly"))).scheduled_transaction.id as string;
    await setNext(daily, "2030-03-09");
    await setNext(monthly, "2030-03-09");
    for (const hh of ["03", "09", "15", "21"]) {
      await cronRun(env, new Date(`2030-03-10T${hh}:00:00Z`), noRun);
    }
    const next = async (id: string) =>
      (await q("select date_next from scheduled_transactions where id = ?", id))[0]?.date_next;
    expect(await realRows(b, a)).toHaveLength(2);
    expect(await next(daily)).toBe("2030-03-10");
    expect(await next(monthly)).toBe("2030-04-09");
    await cronRun(env, new Date("2030-03-11T03:00:00Z"), noRun);
    const dates = (await realRows(b, a)).map((r) => r.date);
    expect(dates.filter((d) => d === "2030-03-09")).toHaveLength(2);
    expect(dates.filter((d) => d === "2030-03-10")).toHaveLength(1);
    expect(dates).toHaveLength(3);
  });

  it("a connection that needs a sign-in is checked once a day", async () => {
    stubBank();
    const w = await world1();
    await q(
      "update bank_connections set status = 'login_required', sync_error_since = ?, last_synced_at = ? where id = ?",
      new Date(Date.now() - H).toISOString(),
      new Date(Date.now() - 48 * H).toISOString(),
      w.conn,
    );
    const calls = stubBank({
      "/accounts/get": () => plaidError(400, "ITEM_LOGIN_REQUIRED"),
      "/transactions/sync": () => plaidError(400, "ITEM_LOGIN_REQUIRED"),
    });
    await q("update bank_connections set status = 'broken' where id != ?", w.conn);
    const run = ((e: typeof env, c: { id: string }, o?: { check?: boolean }) =>
      runSync(e, c.id, o)) as unknown as Run;
    const t = Date.now();
    const asked: number[] = [];
    for (let k = 0; k < 5; k++) {
      calls.length = 0;
      await syncDueConnections(env, new Date(t + k * 6 * H), run);
      asked.push(calls.filter((c) => c.url.endsWith("/accounts/get")).length);
    }
    expect(asked).toEqual([1, 0, 0, 0, 1]);
  });
});
