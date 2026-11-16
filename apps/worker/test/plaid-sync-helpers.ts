import { env } from "cloudflare:test";
import { expect } from "vitest";
import type { Env } from "../src/env";
import { json } from "./helpers";
import {
  ALL_SENTINELS,
  createPlan,
  type FeedPage,
  type PlaidCall,
  type PlaidHandler,
  SENTINEL,
  seedSandboxCredentials,
  stubPlaid,
  syncPages,
} from "./plaid-stub";

export type Json = Record<string, any>;
export const T = "2026-03-10";
export const data = async (res: Response) => ((await res.json()) as Json).data;
export const clean = (text: string) => ALL_SENTINELS.every((s) => !text.includes(s));
export const REST_ACTOR = "user:tester@localhost";

export const feed: { pages: FeedPage[] } = { pages: [] };
export const balances: Record<string, number> = { "acc-chk": 1250.5, "acc-sav": 300 };
let item = 0;

/** The Plaid stand-in: two depository accounts, `feed.pages` for /transactions/sync. Returns the call log. */
export function stubBank(extra: Record<string, PlaidHandler> = {}) {
  return stubPlaid({
    "/item/public_token/exchange": () => ({
      body: { access_token: SENTINEL.accessToken, item_id: `item-sync-${Date.now()}-${item++}` },
    }),
    "/accounts/get": () => ({
      body: {
        item: { institution_id: "ins_109508" },
        accounts: [
          ["acc-chk", "ZZ Checking", "checking"],
          ["acc-sav", "ZZ Savings", "savings"],
        ].map(([account_id, name, subtype]) => ({
          account_id,
          name,
          mask: "0000",
          type: "depository",
          subtype,
          balances: { current: balances[account_id as string], available: null },
        })),
      },
    }),
    "/institutions/get_by_id": () => ({
      body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
    }),
    "/transactions/sync": syncPages(() => feed.pages),
    ...extra,
  });
}

export async function setupPlaid() {
  feed.pages = [];
  balances["acc-chk"] = 1250.5;
  balances["acc-sav"] = 300;
  await seedSandboxCredentials();
}

/** A Sandbox plan with a connection (through REST) and the bank account ids by name. */
export async function world() {
  const plan = await createPlan("sandbox");
  const res = await json(
    "/api/v1/bank-connections",
    { method: "POST" },
    { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
  );
  expect(res.status).toBe(201);
  const conn = (await data(res)).bank_connection as Json;
  const bank: Record<string, string> = {};
  for (const a of conn.accounts as Json[]) bank[a.name as string] = a.id as string;
  return { plan, conn: conn.id as string, bank };
}

export const A = (plan: string) => `/api/v1/budgets/${plan}/accounts`;
export const TX = (plan: string) => `/api/v1/budgets/${plan}/transactions`;

/** A plan account linked to a bank account, created with a Starting Balance dated T. */
export async function linked(plan: string, bankAccountId: string): Promise<string> {
  const res = await json(
    `${A(plan)}/from-bank`,
    { method: "POST" },
    { bank_account_ids: [bankAccountId], today: T },
  );
  expect(res.status).toBe(201);
  return (await data(res)).created[0].account.id as string;
}

export async function world1() {
  const w = await world();
  const account = await linked(w.plan, w.bank["ZZ Checking"] as string);
  return { ...w, account };
}

export const syncOne = async (plan: string, conn: string) => {
  const res = await json(`/api/v1/bank-connections/${conn}/sync?budget_id=${plan}`, {
    method: "POST",
  });
  expect(res.status).toBe(200);
  return (await data(res)) as Json;
};

export const rows = async (account: string, live = true) =>
  (
    await env.DB.prepare(
      `select * from transactions where account_id = ? ${live ? "and deleted_at is null" : ""} order by date, id`,
    )
      .bind(account)
      .all<Json>()
  ).results;

export const imports = async (account: string) =>
  (await rows(account)).filter((r) => r.source === "plaid");

export const q = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;
export const count = async (sql: string, ...b: unknown[]) =>
  ((await q(sql, ...b))[0] as Json | undefined)?.n as number;
export const logCount = (entity?: string) =>
  entity
    ? count("select count(*) n from change_log where entity_type = ?", entity)
    : count("select count(*) n from change_log");
export const connRow = async (conn: string) =>
  (await q("select * from bank_connections where id = ?", conn))[0] as Json;

export const planCalls = (calls: PlaidCall[], path: string) =>
  calls.filter((c) => c.url.endsWith(path));

/** An env whose `DB.batch` throws on its n-th call once (counting from the call of this wrapper). */
export function failingBatchEnv(n: number): Env {
  let seen = 0;
  const DB = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          if (++seen === n) throw new Error("simulated D1 failure");
          return target.batch(stmts);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...env, DB } as Env;
}

export const hand = (plan: string, body: Json) => json(TX(plan), { method: "POST" }, { ...body });
