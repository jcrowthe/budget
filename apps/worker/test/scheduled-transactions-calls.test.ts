import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { cronRun } from "../src/scheduled";
import {
  bulkScheduled,
  createScheduled,
  enterDue,
  enterScheduledNow,
  listScheduled,
  updateScheduled,
} from "../src/services/scheduled-transactions";
import {
  account,
  type Json,
  plan,
  q,
  realRows,
  S,
  sched,
  schedLogs,
  TODAY,
} from "./scheduled-helpers";
import { actor } from "./bulk-helpers";

/** `env` whose database counts each executed statement (run, all, first, raw) and each batch as one call. */
function counting(): { env: Env; calls: () => number; reset: () => void } {
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
  return { env: { ...env, DB: db } as Env, calls: () => n, reset: () => (n = 0) };
}

const mk = (a: string, n: number, extra: Json = {}) => ({
  account_id: a,
  date_first: "2026-12-01",
  frequency: "monthly",
  amount: -100 - n,
  payee_name: `ZZ Payee ${n % 5}`,
  ...extra,
});

/** `n` schedules in one plan, inserted by SQL in one go (they are all due on `due`). */
async function insertDue(budgetId: string, accountId: string, n: number, due: string) {
  const now = new Date().toISOString();
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare(
      "insert into scheduled_transactions (id, budget_id, account_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values (?, ?, ?, ?, ?, 'monthly', ?, 0, ?, ?, ?)",
    ).bind(crypto.randomUUID(), budgetId, accountId, due, due, -100 - i, crypto.randomUUID(), now, now),
  );
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function world(n: number, due = "2026-11-16") {
  const b = await plan();
  const a = await account(b);
  await insertDue(b, a, n, due);
  return { b, a };
}

const figures: Record<string, number> = {};

describe("scheduled transactions: D1 calls", () => {
  it("enter-due makes the same few calls for 10 and for 100 due schedules", async () => {
    const out: number[] = [];
    for (const n of [10, 100]) {
      const { b, a } = await world(n);
      const c = counting();
      const r = await enterDue(c.env, { budgetIds: [b], day: "2026-11-16", actor: "service:scheduler" });
      expect(r.entered).toHaveLength(n);
      expect(await realRows(b, a)).toHaveLength(n);
      out.push(c.calls());
    }
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBeLessThanOrEqual(2);
    figures["enter-due 10"] = out[0] as number;
    figures["enter-due 100"] = out[1] as number;
  });

  it("bulk enter now and delete: a fixed number of calls for 10 and for 100 ids", async () => {
    const result: Record<string, number[]> = { enter_now: [], delete: [] };
    for (const op of ["enter_now", "delete"] as const) {
      for (const n of [10, 100]) {
        const { b } = await world(n, "2026-12-01");
        const ids = (await q("select id from scheduled_transactions where budget_id = ?", b)).map((r) => r.id as string);
        const c = counting();
        const r = await bulkScheduled(c.env, actor, b, { op, ids }, TODAY);
        expect(r.results).toHaveLength(n);
        result[op]?.push(c.calls());
      }
    }
    expect(result.enter_now?.[0]).toBe(result.enter_now?.[1]);
    expect(result.delete?.[0]).toBe(result.delete?.[1]);
    expect(result.enter_now?.[1]).toBeLessThanOrEqual(5);
    expect(result.delete?.[1]).toBeLessThanOrEqual(3);
    figures["bulk enter 10"] = result.enter_now?.[0] as number;
    figures["bulk enter 100"] = result.enter_now?.[1] as number;
    figures["bulk delete 100"] = result.delete?.[1] as number;
  });

  it("create, update and list stay inside their budgets", async () => {
    const b = await plan();
    const a = await account(b);
    const a2 = await account(b);
    const c = counting();
    const created = await createScheduled(
      c.env,
      actor,
      b,
      mk(a, 1, { date_first: "2026-11-01", payee_name: "ZZ New Payee" }) as never,
      TODAY,
    );
    expect(created.transaction).not.toBeNull();
    expect(c.calls()).toBeLessThanOrEqual(7);
    figures["create"] = c.calls();
    c.reset();
    await updateScheduled(
      c.env,
      actor,
      b,
      created.scheduled_transaction.id,
      { account_id: a2, payee_name: "ZZ Other Payee", date_first: "2026-11-02", memo: "x" },
      TODAY,
    );
    expect(c.calls()).toBeLessThanOrEqual(8);
    figures["update"] = c.calls();
    c.reset();
    await listScheduled(c.env, b);
    expect(c.calls()).toBeLessThanOrEqual(2);
    figures["list"] = c.calls();
  });

  it("the cron's invocation stays inside 41 calls with the bank sync, enters the day before, and caps the run", async () => {
    const plans = [await world(0), await world(0), await world(0)];
    const first = plans[0];
    if (!first) throw new Error("no plan");
    for (const [i, p] of plans.entries()) await insertDue(p.b, p.a, 50, "2026-11-16");
    // one due on the cron's own day (11/17) must not be entered
    await insertDue(first.b, first.a, 1, "2026-11-17");
    const now = new Date().toISOString();
    const conns = Array.from({ length: 45 }, () =>
      env.DB.prepare(
        "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, created_at, updated_at) values (?, ?, 'sandbox', ?, 'ins_1', 'ZZ Bank', 'ZZ Bank', 'connected', 'Plaid', ?, ?)",
      ).bind(crypto.randomUUID(), crypto.randomUUID().slice(0, 6), crypto.randomUUID(), now, now),
    );
    await env.DB.batch(conns);
    const c = counting();
    let runs = 0;
    await cronRun(c.env, new Date("2026-11-17T03:00:00Z"), (async () => {
      runs += 1;
      return { has_more: false } as never;
    }) as never);
    const entered = await q("select count(*) n from transactions where date = '2026-11-16' and approved = 0 and budget_id in (?, ?, ?)", ...plans.map((p) => p.b));
    expect(entered[0]?.n).toBe(100);
    const actors = await q("select distinct actor from change_log where entity_type = 'scheduled_transaction' and action = 'update' and budget_id in (?, ?, ?)", ...plans.map((p) => p.b));
    expect(actors.map((x) => x.actor)).toEqual(["service:scheduler"]);
    expect((await q("select count(*) n from scheduled_transactions where date_next = '2026-11-17' and budget_id = ?", first.b))[0]?.n).toBe(1);
    expect(runs).toBeLessThanOrEqual(37);
    expect(c.calls() + runs).toBeLessThanOrEqual(41);
    figures["cron d1"] = c.calls();
    figures["cron runs"] = runs;
    // the rest is left for the next run
    c.reset();
    await cronRun(c.env, new Date("2026-11-17T03:00:00Z"), (async () => ({ has_more: false }) as never) as never);
    expect((await q("select count(*) n from transactions where date = '2026-11-16' and approved = 0 and budget_id in (?, ?, ?)", ...plans.map((p) => p.b)))[0]?.n).toBe(150);
  });

  it("reports the figures", () => {
    console.info(
      `scheduled-calls: enter-due 10=${figures["enter-due 10"]} 100=${figures["enter-due 100"]}; bulk 10=${figures["bulk enter 10"]} 100=${figures["bulk enter 100"]} delete 100=${figures["bulk delete 100"]}; create=${figures.create} update=${figures.update} list=${figures.list}; cron d1=${figures["cron d1"]} runs=${figures["cron runs"]}`,
    );
  });
});

describe("scheduled transactions: races", () => {
  it("two Enter Now calls started together enter one occurrence", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, mk(a, 1, { date_first: "2026-11-25" }))).scheduled_transaction.id;
    const results = await Promise.allSettled([
      enterScheduledNow(env, actor, b, id, TODAY),
      enterScheduledNow(env, actor, b, id, TODAY),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409, code: "conflict" });
    expect(await realRows(b, a)).toHaveLength(1);
    expect((await q("select date_next from scheduled_transactions where id = ?", id))[0]?.date_next).toBe("2026-12-25");
    expect((await schedLogs(id)).map((l) => l.action)).toEqual(["create", "update"]);
  });

  it("two enter-due calls started together enter one row per due schedule", async () => {
    const { b, a } = await world(5);
    const [r1, r2] = await Promise.all([
      enterDue(env, { budgetIds: [b], day: "2026-11-16", actor: "service:scheduler" }),
      enterDue(env, { budgetIds: [b], day: "2026-11-16", actor: "service:scheduler" }),
    ]);
    expect(r1.entered.length + r2.entered.length).toBe(5);
    expect(await realRows(b, a)).toHaveLength(5);
    // one `update` log row per schedule, none doubled
    expect((await q("select count(*) n from change_log where budget_id = ? and entity_type = 'scheduled_transaction'", b))[0]?.n).toBe(5);
    expect((await q("select count(*) n from change_log where budget_id = ? and entity_type = 'transaction' and action = 'create' and json_extract(after_json, '$.date') = '2026-11-16'", b))[0]?.n).toBe(5);
  });

  it("a gate whose token changed between the read and the batch writes nothing", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, mk(a, 1, { date_first: "2026-11-25" }))).scheduled_transaction.id;
    const before = (await q("select count(*) n from change_log where budget_id = ?", b))[0]?.n;
    const res = await bulkScheduled(env, actor, b, { op: "enter_now", ids: [id] }, TODAY, {
      beforeWrite: async () => {
        await env.DB.prepare("update scheduled_transactions set write_token = 'other' where id = ?").bind(id).run();
      },
    });
    expect(res.results).toEqual([]);
    expect(res.skipped).toEqual([{ id, reason: "changed" }]);
    expect(await realRows(b, a)).toEqual([]);
    expect((await q("select count(*) n from change_log where budget_id = ?", b))[0]?.n).toBe(before);
    expect(S(b)).toContain(b);
  });
});
