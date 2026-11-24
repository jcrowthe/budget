import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { deleteCategoryGroup } from "../src/services/category-delete";
import { actor, api, type Json, send } from "./category-helpers";
import { account, plan, q, sched } from "./scheduled-helpers";

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
      if (k === "prepare") return (s: string) => wrap(t.prepare(s));
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

const base = (acc: string, extra: Json = {}) => ({
  account_id: acc,
  date_first: "2026-12-01",
  frequency: "monthly",
  amount: -500,
  payee_name: "ZZ Payee",
  ...extra,
});

async function seed(n: number) {
  const bid = await plan();
  const acc = await account(bid);
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "Spend" });
  const mkCat = async (name: string) =>
    (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name })).id;
  const toGroup = await createCategoryGroup(env, actor, { budget_id: bid, name: "Keep" });
  const target = (
    await createCategory(env, actor, { budget_id: bid, group_id: toGroup.id, name: "Target" })
  ).id;
  const cats: string[] = [];
  for (let i = 0; i < n; i++) cats.push(await mkCat(`C${i}`));
  const now = new Date().toISOString();
  const stmts = cats.map((c, i) =>
    env.DB.prepare(
      "insert into scheduled_transactions (id, budget_id, account_id, date_first, date_next, frequency, amount, category_id, write_token, created_at, updated_at) values (?, ?, ?, '2026-12-01', '2026-12-01', 'monthly', -100, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), bid, acc, c, `tok-${i}`, now, now),
  );
  await env.DB.batch(stmts);
  return { bid, acc, g, cats, target };
}

const rows = (bid: string) =>
  q(
    "select id, category_id, write_token from scheduled_transactions where budget_id = ? and deleted_at is null",
    bid,
  );

describe("category delete moves schedules (EXF-659)", () => {
  it("with a replacement the schedules move, with a history row and a new write token each", async () => {
    const bid = await plan();
    const acc = await account(bid);
    const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "G" });
    const a = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "A" })).id;
    const b = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "B" })).id;
    const s1 = await sched(bid, base(acc, { category_id: a }));
    const s2 = await sched(bid, base(acc, { category_id: a, payee_name: "ZZ Two" }));
    const before = await rows(bid);
    const usage = await send("GET", api(bid, `/categories/${a}/usage`));
    expect(((await usage.json()) as Json).data.usage.scheduled_count).toBe(2);
    const res = await send("DELETE", api(bid, `/categories/${a}?reassign_to=${b}`));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('"schedules_moved":2');
    const after = await rows(bid);
    expect(after.map((r) => r.category_id)).toEqual([b, b]);
    for (const r of after) {
      expect(r.write_token).not.toBe(before.find((x) => x.id === r.id)?.write_token);
    }
    const log = await q(
      "select entity_id from change_log where budget_id = ? and entity_type = 'scheduled_transaction' and action = 'update' and entity_id in (?, ?)",
      bid,
      s1.scheduled_transaction.id,
      s2.scheduled_transaction.id,
    );
    expect(log).toHaveLength(2);
  });

  it("without a replacement the schedule's category is cleared, with a history row", async () => {
    const bid = await plan();
    const acc = await account(bid);
    const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "G" });
    const a = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "A" })).id;
    const s = await sched(bid, base(acc, { category_id: a }));
    const res = await send("DELETE", api(bid, `/categories/${a}`));
    expect(res.status).toBe(200);
    const [r] = await rows(bid);
    expect(r.category_id).toBeNull();
    const log = await q(
      "select 1 from change_log where entity_id = ? and entity_type = 'scheduled_transaction' and action = 'update'",
      s.scheduled_transaction.id,
    );
    expect(log).toHaveLength(1);
  });
});

describe("group delete moves schedules (EXF-659)", () => {
  it("a group of 35 categories: every schedule moves", async () => {
    const s = await seed(35);
    const res = await send(
      "DELETE",
      api(s.bid, `/category_groups/${s.g.id}?reassign_to=${s.target}`),
    );
    expect(res.status).toBe(200);
    const after = await rows(s.bid);
    expect(after).toHaveLength(35);
    expect(after.every((r) => r.category_id === s.target)).toBe(true);
    const log = await q(
      "select count(*) n from change_log where budget_id = ? and entity_type = 'scheduled_transaction' and action = 'update'",
      s.bid,
    );
    expect(log[0].n).toBe(35);
  });

  it("D1 calls do not grow with the category count (3 vs 35 vs 120)", async () => {
    const measure = async (n: number) => {
      const s = await seed(n);
      const c = counting();
      await deleteCategoryGroup(c.env, actor, {
        budget_id: s.bid,
        group_id: s.g.id,
        reassign_to: s.target,
      });
      expect((await rows(s.bid)).every((r) => r.category_id === s.target)).toBe(true);
      return c.calls();
    };
    const [a, b, c] = [await measure(3), await measure(35), await measure(120)];
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("a schedule already pointing at a deleted category reads as uncategorized", async () => {
    const bid = await plan();
    const acc = await account(bid);
    const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "G" });
    const a = (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: "A" })).id;
    await sched(bid, base(acc, { category_id: a }));
    await env.DB.prepare("update categories set deleted_at = ? where id = ?")
      .bind(new Date().toISOString(), a)
      .run();
    const res = await send("GET", api(bid, "/scheduled-transactions"));
    expect(res.status).toBe(200);
  });
});
