import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { pairLoanCategory } from "../src/services/loan-pairing";
import { account } from "./bulk-helpers";
import { actor, MORTGAGE, newPlan, openAccount, rand, send } from "./loan-world";

// Loan manage: unpair and pair-with-a-new-category make a fixed number of D1 calls, whatever the plan holds.

/** `env` whose database counts each executed statement and each batch as one call. */
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

/** `months` months x `perMonth` payments from 2024-01, in one statement. */
async function seedPayments(
  b: string,
  loan: string,
  from: string,
  months: number,
  perMonth: number,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 0 union all select i + 1 from s where i < ?)
     insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, transfer_account_id)
     select 'zz-' || hex(randomblob(8)), ?, ?, date('2024-01-15', '+' || (i / ?) || ' months'), 1000, 'cleared', 1, ?, ?, 0, ?
     from s`,
  )
    .bind(months * perMonth - 1, b, loan, perMonth, now, now, from)
    .run();
}

/** `groups` groups of one category each, in one statement. */
async function seedCategories(b: string, groups: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `with recursive s(i) as (select 1 union all select i + 1 from s where i < ?)
     insert into category_groups (id, budget_id, name, sort_order, hidden, collapsed, created_at, updated_at)
     select 'zzg-' || ? || '-' || i, ?, 'ZZ-TEST G' || i, 100 + i, 0, 0, ?, ? from s`,
  )
    .bind(groups, b.slice(0, 6), b, now, now)
    .run();
  await env.DB.prepare(
    `insert into categories (id, budget_id, group_id, name, sort_order, hidden, created_at, updated_at)
     select 'zzc-' || id, budget_id, id, 'ZZ-TEST C', 0, 0, ?, ? from category_groups where budget_id = ? and id like 'zzg-%'`,
  )
    .bind(now, now, b)
    .run();
}

type Kind = "unpair" | "new-group" | "existing-group";

async function measure(n: number, kind: Kind) {
  const b = await newPlan();
  const checking = await account(b, "checking", 100000000);
  const loan = (await openAccount(b, { ...MORTGAGE, date: "2024-01-01" })).id as string;
  await seedPayments(b, loan, checking, 1, n);
  await seedCategories(b, n);
  let groupId = "";
  if (kind === "existing-group") {
    groupId = (
      await env.DB.prepare("select id from category_groups where budget_id = ? limit 1")
        .bind(b)
        .first<{ id: string }>()
    )?.id as string;
  }
  if (kind === "unpair") {
    const res = await send(`/api/v1/budgets/${b}/accounts/${loan}/paired-category`, "PUT", {
      new_category: { name: `ZZ-TEST ${rand()}`, new_group_name: `ZZ-TEST ${rand()}` },
    });
    expect(res.status).toBe(200);
  }
  const input =
    kind === "unpair"
      ? { category_id: null }
      : kind === "new-group"
        ? { new_category: { name: `ZZ-TEST ${rand()}`, new_group_name: `ZZ-TEST ${rand()}` } }
        : { new_category: { name: `ZZ-TEST ${rand()}`, group_id: groupId } };
  const c = counting();
  const res = await pairLoanCategory(c.env, actor, b, loan, input);
  expect(res.paired_category_id === null).toBe(kind === "unpair");
  return c.calls();
}

// Measured on this build: see docs/loan-manage-design.md "Build notes".
const PINNED: Record<Kind, number> = { unpair: -1, "new-group": -1, "existing-group": -1 };

describe("pairing writes: constant D1 calls", () => {
  it.each(Object.keys(PINNED) as Kind[])("%s: the same for 10 and 100", async (kind) => {
    const small = await measure(10, kind);
    const large = await measure(100, kind);
    expect(large).toBe(small);
    expect(small).toBe(PINNED[kind]);
  });
});
