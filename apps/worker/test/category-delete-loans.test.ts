import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { deleteCategory, deleteCategoryGroup } from "../src/services/category-delete";
import { account, actor, type Json, plan, q, send, tx } from "./bulk-helpers";
import { setOf, undo } from "./undo-helpers";

// EXF-990: deleting or merging a category moves (reassign_to) or clears a loan account's paired_category_id.
const B = (bid: string) => `/api/v1/budgets/${bid}`;

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

async function loan(bid: string, paired: string | null): Promise<string> {
  const res = await send(`${B(bid)}/accounts`, "POST", {
    name: `ZZ loan ${crypto.randomUUID().slice(0, 8)}`,
    type: "mortgage",
    balance: 1000000,
    interest_rate: "5",
    minimum_payment: 1000,
    date: "2026-11-10",
    ...(paired ? { paired_category_id: paired } : {}),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}

async function seed(n = 2) {
  const bid = await plan();
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "Debts" });
  const keep = await createCategoryGroup(env, actor, { budget_id: bid, name: "Keep" });
  const mk = async (gid: string, name: string) =>
    (await createCategory(env, actor, { budget_id: bid, group_id: gid, name })).id;
  const cats: string[] = [];
  for (let i = 0; i < n; i++) cats.push(await mk(g.id, `D${i}`));
  const target = await mk(keep.id, "Target");
  const other = await mk(keep.id, "Other");
  const loans: string[] = [];
  for (const c of cats) loans.push(await loan(bid, c));
  const untouched = await loan(bid, other);
  const unpaired = await loan(bid, null);
  return { bid, g, cats, target, other, loans, untouched, unpaired };
}

const paired = async (id: string) =>
  (await q("select paired_category_id p from accounts where id = ?", id))[0]?.p ?? null;
const acctLogs = (bid: string) =>
  q(
    "select entity_id, action, before_json, after_json, change_set_id from change_log where budget_id = ? and entity_type = 'account' and action = 'update' order by rowid",
    bid,
  );

describe("category delete and the loan pairing", () => {
  it("with reassign_to the pairing moves to it, with a change_log row", async () => {
    const s = await seed(1);
    const res = await send(`${B(s.bid)}/categories/${s.cats[0]}?reassign_to=${s.target}`, "DELETE");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await paired(s.loans[0] as string)).toBe(s.target);
    expect(await paired(s.untouched)).toBe(s.other);
    expect(await paired(s.unpaired)).toBeNull();
    const rows = await acctLogs(s.bid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe(s.loans[0]);
    expect(JSON.parse(rows[0]?.before_json).paired_category_id).toBe(s.cats[0]);
    expect(JSON.parse(rows[0]?.after_json).paired_category_id).toBe(s.target);
    expect(rows[0]?.change_set_id).toBe(setOf(res));
  });

  it("without reassign_to the pairing becomes null", async () => {
    const s = await seed(1);
    const res = await send(`${B(s.bid)}/categories/${s.cats[0]}`, "DELETE");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await paired(s.loans[0] as string)).toBeNull();
    expect(await paired(s.untouched)).toBe(s.other);
    const rows = await acctLogs(s.bid);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.before_json).paired_category_id).toBe(s.cats[0]);
    expect(JSON.parse(rows[0]?.after_json).paired_category_id).toBeNull();
  });

  it("a group delete moves or clears every pairing in it", async () => {
    const a = await seed(3);
    const r1 = await send(
      `${B(a.bid)}/category-groups/${a.g.id}?reassign_to=${a.target}`,
      "DELETE",
    );
    expect(r1.status, await r1.clone().text()).toBe(200);
    for (const l of a.loans) expect(await paired(l)).toBe(a.target);
    expect(await paired(a.untouched)).toBe(a.other);
    expect(await acctLogs(a.bid)).toHaveLength(3);

    const b = await seed(3);
    const r2 = await send(`${B(b.bid)}/category-groups/${b.g.id}`, "DELETE");
    expect(r2.status, await r2.clone().text()).toBe(200);
    for (const l of b.loans) expect(await paired(l)).toBeNull();
    expect(await paired(b.untouched)).toBe(b.other);
    expect(await acctLogs(b.bid)).toHaveLength(3);
  });

  it("undoing the delete restores the pairing (reassign_to and plain)", async () => {
    const s = await seed(1);
    const r1 = await send(`${B(s.bid)}/categories/${s.cats[0]}?reassign_to=${s.target}`, "DELETE");
    expect(r1.status).toBe(200);
    const u1 = await undo(s.bid, setOf(r1));
    expect(u1.status, JSON.stringify(u1.body)).toBe(200);
    expect(await paired(s.loans[0] as string)).toBe(s.cats[0]);

    const r2 = await send(`${B(s.bid)}/categories/${s.cats[0]}`, "DELETE");
    expect(r2.status).toBe(200);
    expect(await paired(s.loans[0] as string)).toBeNull();
    const u2 = await undo(s.bid, setOf(r2));
    expect(u2.status, JSON.stringify(u2.body)).toBe(200);
    expect(await paired(s.loans[0] as string)).toBe(s.cats[0]);
  });

  it("with history and reassign_to the pairing moves too", async () => {
    const s = await seed(1);
    const acc = await account(s.bid);
    await tx(s.bid, {
      account_id: acc,
      date: "2026-11-10",
      amount: -1000,
      category_id: s.cats[0],
    });
    const res = await send(`${B(s.bid)}/categories/${s.cats[0]}?reassign_to=${s.target}`, "DELETE");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await paired(s.loans[0] as string)).toBe(s.target);
  });

  it("D1 calls do not grow with the number of loans or categories", async () => {
    const run = async (n: number, group: boolean) => {
      const s = await seed(n);
      const c = counting();
      if (group)
        await deleteCategoryGroup(c.env, actor, {
          budget_id: s.bid,
          group_id: s.g.id,
          reassign_to: s.target,
        });
      else
        await deleteCategory(c.env, actor, {
          budget_id: s.bid,
          category_id: s.cats[0] as string,
          reassign_to: s.target,
        });
      return c.calls();
    };
    expect(await run(5, false)).toBe(await run(1, false));
    expect(await run(5, true)).toBe(await run(1, true));
  });
});
