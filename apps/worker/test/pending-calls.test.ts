import { beforeEach, describe, expect, it } from "vitest";
import { pend, pendingRows, pendingWorld } from "./pending-helpers";
import { plaidTxn } from "./plaid-stub";
import { countingEnv, feed, type Json, setupPlaid, TX } from "./plaid-sync-helpers";

beforeEach(setupPlaid);

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    pend(`ZZ-P${String(i).padStart(4, "0")}`, { amount: 1 + i / 100, date: "2026-03-12" }),
  );
const posted = () => [
  plaidTxn({ transaction_id: "ZZ-OUT", amount: 12.34, date: "2026-03-11", name: "ZZ Out" }),
  plaidTxn({ transaction_id: "ZZ-IN", amount: -50, date: "2026-03-12", name: "ZZ In" }),
];

/** D1 calls of one sync run that stores `n` pending items next to the same posted ones. */
async function syncCalls(n: number) {
  const w = await pendingWorld();
  feed.pages = [{ added: [...posted(), ...many(n)] }] as typeof feed.pages;
  const c = countingEnv();
  const { runSync } = await import("../src/services/plaid-sync");
  const before = w.calls.length;
  const r = await runSync(c.env, w.conn);
  expect(r.added).toBe(2);
  expect(await pendingRows(w.account)).toHaveLength(n);
  return { d1: c.calls.d1, plaid: w.calls.length - before };
}

describe("pending: constant D1 calls (EXF-466, C1-C4)", () => {
  it("C1: a sync with 10 and with 100 pending items makes the same D1 calls, inside 45", async () => {
    const ten = await syncCalls(10);
    await setupPlaid();
    const hundred = await syncCalls(100);
    console.log("EXF-466 C1 sync calls", JSON.stringify({ ten, hundred }));
    expect(hundred.d1).toBe(ten.d1);
    expect(hundred.plaid).toBe(ten.plaid);
    expect(hundred.d1 + hundred.plaid).toBeLessThanOrEqual(45);
  }, 60_000);

  async function listCalls(n: number, url: (w: Json) => string) {
    const w = await pendingWorld();
    if (n > 0) await w.bank({ added: many(n) });
    const c = countingEnv();
    const { createApp } = await import("../src/app");
    const { authed } = await import("./helpers");
    const { env: realEnv } = await import("cloudflare:test");
    const res = await createApp().request(url(w), await authed(), { ...realEnv, DB: c.env.DB }, {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Json).data;
    return { d1: c.calls.d1, body };
  }

  it("C2: the pending list with 10 and with 100 rows makes the same D1 calls", async () => {
    const url = (w: Json) => `${TX(w.plan)}?status=pending&account_id=${w.account}`;
    const ten = await listCalls(10, url);
    await setupPlaid();
    const hundred = await listCalls(100, url);
    console.log("EXF-466 C2 list calls", JSON.stringify({ ten: ten.d1, hundred: hundred.d1 }));
    expect(ten.body.transactions).toHaveLength(10);
    expect(hundred.body.transactions).toHaveLength(100);
    expect(hundred.d1).toBe(ten.d1);
  }, 60_000);

  it("C3: the account register list is unchanged by pending rows: 0, 10 and 100 make the same calls", async () => {
    const url = (w: Json) => `/api/v1/budgets/${w.plan}/accounts/${w.account}/transactions`;
    const none = await listCalls(0, url);
    await setupPlaid();
    const ten = await listCalls(10, url);
    await setupPlaid();
    const hundred = await listCalls(100, url);
    console.log(
      "EXF-466 C3 register calls",
      JSON.stringify({ none: none.d1, ten: ten.d1, hundred: hundred.d1 }),
    );
    expect(ten.d1).toBe(none.d1);
    expect(hundred.d1).toBe(none.d1);
    expect(hundred.body.transactions).toHaveLength(none.body.transactions.length);
  }, 60_000);

  it("C4: Enter Now makes a constant number of D1 calls", async () => {
    const calls = async (n: number) => {
      const w = await pendingWorld();
      await w.bank({ added: many(n) });
      const [first] = await pendingRows(w.account);
      const c = countingEnv();
      const { createApp } = await import("../src/app");
      const { authed } = await import("./helpers");
      const { env: realEnv } = await import("cloudflare:test");
      const res = await createApp().request(
        `${TX(w.plan)}/${first?.id}/enter-now`,
        await authed({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        { ...realEnv, DB: c.env.DB },
        { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext,
      );
      expect(res.status).toBe(200);
      return c.calls.d1;
    };
    const ten = await calls(10);
    await setupPlaid();
    const hundred = await calls(100);
    console.log("EXF-466 C4 enter-now calls", JSON.stringify({ ten, hundred }));
    expect(hundred).toBe(ten);
    expect(ten).toBe(8);
  }, 60_000);
});
