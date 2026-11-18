import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createAccountsFromBank } from "../src/services/account-links";
import { getAccount, listAccounts } from "../src/services/accounts";
import { deleteBudget } from "../src/services/budgets";
import { account, actor, DAY, tx } from "./bulk-helpers";
import { json } from "./helpers";
import { createPlan, SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
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

/** Measured on b39c8cd: deleting a plan was 2 calls (findActive, batch). */
describe("EXF-824: D1 calls of deleting a plan", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-dc-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: Array.from({ length: 10 }, (_, i) => ({
            account_id: `acc-${i}-${crypto.randomUUID()}`,
            name: `ZZ ${i}`,
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

  async function bankIds(plan: string): Promise<string[]> {
    const res = await json(
      "/api/v1/bank-connections",
      { method: "POST" },
      { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
    );
    const d = ((await res.json()) as any).data;
    return ((d.bank_connection ?? d).accounts as { id: string }[]).map((a) => a.id);
  }

  it("3 with no linked account, 6 with one, 6 with ten linked accounts and 100 transactions", async () => {
    const none = await createPlan("sandbox");
    const c0 = counting();
    await deleteBudget(c0.env, actor, none);
    expect(c0.calls()).toBe(3);

    const one = await createPlan("sandbox");
    const ids1 = await bankIds(one);
    await createAccountsFromBank(env, actor, one, { bank_account_ids: [ids1[0] as string] });
    const c1 = counting();
    await deleteBudget(c1.env, actor, one);
    expect(c1.calls()).toBe(6);

    const many = await createPlan("sandbox");
    const ids = await bankIds(many);
    const made = await createAccountsFromBank(env, actor, many, { bank_account_ids: ids });
    expect(made.created.length).toBe(10);
    const acct = await account(many);
    for (let i = 0; i < 100; i++) {
      await tx(many, { account_id: acct, date: DAY, amount: -1000 - i });
    }
    const c10 = counting();
    await deleteBudget(c10.env, actor, many);
    expect(c10.calls()).toBe(6);
  });

  it("the account reads stay at 5", async () => {
    const plan = await createPlan("sandbox");
    const ids = await bankIds(plan);
    const made = await createAccountsFromBank(env, actor, plan, {
      bank_account_ids: [ids[0] as string],
    });
    const list = counting();
    await listAccounts(list.env, plan);
    expect(list.calls()).toBe(5);
    const get = counting();
    await getAccount(get.env, plan, made.created[0]?.account.id as string);
    expect(get.calls()).toBe(5);
  });
});
