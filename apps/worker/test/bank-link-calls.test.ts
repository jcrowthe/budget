import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createAccountsFromBank, linkAccount, unlinkAccount } from "../src/services/account-links";
import { getAccount, listAccounts, updateAccount } from "../src/services/accounts";
import { account, actor } from "./bulk-helpers";
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

/** Measured on main 8e54173 (before the two link fields); the joins sit in the same statements, so none may change. */
const MEASURED = { list: 5, get: 5, rename: 7, link: 10, unlink: 6, fromBank1: 9, fromBank2: 15 };

describe("bank link: D1 calls of the account reads and link writes do not grow", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-calls-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: ["a", "b", "c"].map((x) => ({
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

  async function bankIds(plan: string): Promise<string[]> {
    const res = await json(
      "/api/v1/bank-connections",
      { method: "POST" },
      { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
    );
    const d = ((await res.json()) as any).data;
    return ((d.bank_connection ?? d).accounts as { id: string }[]).map((a) => a.id);
  }

  it("measures and holds", async () => {
    const plan = await createPlan("sandbox");
    const ids = await bankIds(plan);
    const a1 = await account(plan);
    await account(plan);
    const list2 = counting();
    await listAccounts(list2.env, plan);
    const got = { list: list2.calls() } as Record<string, number>;
    for (let i = 0; i < 8; i++) await account(plan);
    const list10 = counting();
    await listAccounts(list10.env, plan);
    expect(list10.calls()).toBe(got.list);
    const get = counting();
    await getAccount(get.env, plan, a1);
    got.get = get.calls();
    const rename = counting();
    await updateAccount(rename.env, actor, plan, a1, { name: "ZZ renamed" });
    got.rename = rename.calls();
    const link = counting();
    await linkAccount(link.env, actor, plan, a1, { bank_account_id: ids[0] as string });
    got.link = link.calls();
    const unlink = counting();
    await unlinkAccount(unlink.env, actor, plan, a1);
    got.unlink = unlink.calls();
    const f1 = counting();
    await createAccountsFromBank(f1.env, actor, plan, { bank_account_ids: [ids[0] as string] });
    got.fromBank1 = f1.calls();
    const f2 = counting();
    await createAccountsFromBank(f2.env, actor, plan, {
      bank_account_ids: [ids[1] as string, ids[2] as string],
    });
    got.fromBank2 = f2.calls();
    expect(got).toEqual(MEASURED);
  });
});
