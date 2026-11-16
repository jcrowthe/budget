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
  plaidTxn,
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

/**
 * An env whose DB counts calls (each statement execution; a batch or exec counts as one), with the counts.
 * Written on its own, apart from the counter of the code under test.
 */
export function countingEnv(base: Env = env): { env: Env; calls: { d1: number }; reset(): void } {
  const calls = { d1: 0 };
  const decorate = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const s = stmt as unknown as Record<string, unknown>;
    const orig = {
      bind: stmt.bind.bind(stmt),
      all: stmt.all.bind(stmt),
      raw: stmt.raw.bind(stmt),
      first: stmt.first.bind(stmt),
      run: stmt.run.bind(stmt),
    };
    s.bind = (...v: unknown[]) => decorate(orig.bind(...v));
    for (const m of ["all", "raw", "first", "run"] as const) {
      s[m] = (...a: unknown[]) => {
        calls.d1++;
        return (orig[m] as (...x: unknown[]) => unknown)(...a);
      };
    }
    return stmt;
  };
  const real = base.DB;
  const DB = Object.create(real) as D1Database;
  const d = DB as unknown as Record<string, unknown>;
  d.prepare = (sql: string) => decorate(real.prepare(sql));
  d.batch = (stmts: D1PreparedStatement[]) => {
    calls.d1++;
    return real.batch(stmts);
  };
  d.exec = (sql: string) => {
    calls.d1++;
    return real.exec(sql);
  };
  return {
    env: { ...base, DB } as Env,
    calls,
    reset() {
      calls.d1 = 0;
    },
  };
}

/** Seeds, by SQL, a payee per name with one categorised hand row dated 2026-01-05 (payee history). */
export async function seedPayeeHistory(
  plan: string,
  account: string,
  names: string[],
  categoryId: string,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const [i, name] of names.entries()) {
    const pid = `zz-hist-p-${i}-${plan.slice(0, 8)}`;
    stmts.push(
      env.DB.prepare(
        "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z')",
      ).bind(pid, plan, name),
      env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id, payee_name, category_id) values (?, ?, ?, '2026-01-05', -1000, 'cleared', 1, '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z', ?, ?, ?)",
      ).bind(`zz-hist-t-${i}-${plan.slice(0, 8)}`, plan, account, pid, name, categoryId),
    );
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/** Runs runSync until has_more is false (at most `max`), returning each result. */
export async function runUntilDone(
  e: Env,
  conn: string,
  opts: Parameters<typeof import("../src/services/plaid-sync").runSync>[2] = {},
  max = 8,
): Promise<Json[]> {
  const { runSync } = await import("../src/services/plaid-sync");
  const out: Json[] = [];
  for (let i = 0; i < max; i++) {
    const r = (await runSync(e, conn, opts)) as unknown as Json;
    out.push(r);
    if (!r.has_more) break;
  }
  return out;
}

const NAMES = Array.from({ length: 500 }, (_, i) => `ZZ Payee ${i}`);
const entries = () =>
  NAMES.map((name, i) =>
    plaidTxn({
      transaction_id: `ZZ-C${String(i).padStart(4, "0")}`,
      amount: 1 + i / 100,
      name,
    }),
  );

/** 500 new entries on one page with payee history for each payee, and ten hand rows to match. */
export async function budgetWorld() {
  const w = await world1();
  const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
  const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
  await seedPayeeHistory(w.plan, w.account, NAMES, cat);
  const list = entries();
  feed.pages = [{ added: list }];
  const stmts = list
    .slice(0, 10)
    .map((t, i) =>
      env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at) values (?, ?, ?, ?, ?, 'cleared', 1, '2026-03-11T00:00:00.000Z', '2026-03-11T00:00:00.000Z')",
      ).bind(
        `zz-hand-${i}-${w.plan.slice(0, 8)}`,
        w.plan,
        w.account,
        t.date,
        -Math.round(t.amount * 1000),
      ),
    );
  await env.DB.batch(stmts);
  return { ...w, cat };
}
