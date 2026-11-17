import { env } from "cloudflare:test";
import { resetAvailableAt as screenRule } from "@budget/schema/manage-connections";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { listBankConnections, resetAvailableAt } from "../src/services/bank-connections";
import { json } from "./helpers";
import { createPlan, SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";

/** `env` whose database counts each executed statement and each batch as one call (as bank-link-calls.test.ts). */
function counting(): { env: Env; calls: () => number } {
  let n = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "run" || k === "all" || k === "first" || k === "raw") {
          return (...a: unknown[]) => {
            n += 1;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    real.set(proxy, st);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "prepare") return (q: string) => wrap(t.prepare(q));
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          n += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n };
}

describe("Manage Bank Connections: the list read", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-mc-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: ["a", "b"].map((x) => ({
            account_id: `acc-${x}-${crypto.randomUUID()}`,
            name: `ZZ ${x}`,
            mask: "0000",
            type: "depository",
            subtype: "checking",
            balances: { current: 10, available: null },
          })),
        },
      }),
      "/institutions/get_by_id": () => ({
        body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
      }),
    });
  });

  async function connect(plan: string) {
    await json(
      "/api/v1/bank-connections",
      { method: "POST" },
      { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
    );
  }

  it("makes 4 D1 calls with 1 and with 10 connections", async () => {
    const plan = await createPlan("sandbox");
    await connect(plan);
    const one = counting();
    expect(await listBankConnections(one.env, plan)).toHaveLength(1);
    expect(one.calls()).toBe(4);
    for (let i = 0; i < 9; i++) await connect(plan);
    const ten = counting();
    expect(await listBankConnections(ten.env, plan)).toHaveLength(10);
    expect(ten.calls()).toBe(4);
  });

  it("the screen's Reset rule is the Worker's", () => {
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    for (const ms of [
      null,
      0,
      1000,
      23 * 3600_000,
      24 * 3600_000,
      24 * 3600_000 + 1,
      48 * 3600_000,
    ]) {
      const last = ms === null ? null : new Date(now - ms).toISOString();
      expect(screenRule(last, now)).toBe(resetAvailableAt(last, now));
    }
  });
});
