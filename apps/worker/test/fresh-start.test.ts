import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { enterDue } from "../src/services/scheduled-transactions";
import {
  actor,
  data,
  dump,
  freshOk,
  freshStart,
  type Json,
  MONTH_T,
  n,
  plans,
  q,
  rand,
  run,
  seedSource,
  send,
  snapshot,
  T,
} from "./fresh-start-helpers";
import { json } from "./helpers";

const names = async () => (await plans()).map((p: Json) => p.name as string);

describe("Fresh Start: the copy (EXF-478)", () => {
  it("1: 201 with both ids", async () => {
    const s = await seedSource();
    const res = await freshStart(s.bid, { name: `ZZ-TEST new ${rand()}`, today: T });
    expect(res.status).toBe(201);
    const d = await data(res);
    expect(d.archived_budget_id).toBe(s.bid);
    expect(d.new_budget_id).not.toBe(s.bid);
    expect(typeof d.new_budget_id).toBe("string");
  });

  it("2: every copied entity type, with ids remapped", async () => {
    const s = await seedSource();
    const before = await dump(s.bid);
    const { new_budget_id: nb } = await freshOk(s.bid, `ZZ-TEST new ${rand()}`);
    const after = await dump(nb);
    // the budget row: formats, expected income, flag names
    expect(after.budget).toEqual(before.budget);
    const b = (await data(await json(`/api/v1/budgets/${nb}`))).budget;
    expect(b).toMatchObject({
      expected_income: 4_000_000,
      date_format: { format: "DD.MM.YYYY" },
      flag_names: { red: "ZZ Urgent", blue: "ZZ Later", green: null },
    });
    expect(b.currency_format).toMatchObject({ iso_code: "EUR", symbol_first: false });
    // accounts: closed stays closed, loan fields and the paired category are the copy's
    expect(after.accounts).toEqual(before.accounts);
    expect(after.accounts.find((a: Json) => a.name === "ZZ Savings").closed).toBe(1);
    expect(after.accounts.find((a: Json) => a.name === "ZZ Loan")).toMatchObject({
      paired: "ZZ Loan Pay",
      escrow_amount: 5000,
      minimum_payment: 90_000,
      interest_rate: "4.5",
      starred: 1,
      note: "ZZ loan note",
    });
    expect(
      await n(
        "select count(*) n from categories where id = (select paired_category_id from accounts where budget_id = ? and name = 'ZZ Loan') and budget_id = ?",
        nb,
        nb,
      ),
    ).toBe(1);
    expect(after.groups).toEqual(before.groups);
    expect(after.categories).toEqual(before.categories);
    const pay = after.categories.find((c: Json) => c.kind === "credit_card_payment");
    expect(pay.account).toBe("ZZ Card");
    expect(
      await n(
        "select count(*) n from categories c join accounts a on a.id = c.account_id where c.budget_id = ? and a.budget_id = ? and c.kind is not null",
        nb,
        nb,
      ),
    ).toBe(1);
    expect(after.targets).toEqual(before.targets);
    expect(after.targets).toHaveLength(3);
    expect(after.targets[0].created_on).toBe("2026-01-05");
    expect(after.snoozes).toEqual([{ category: "ZZ Rent", month: MONTH_T }]);
    expect(after.months.map((m: Json) => m.month)).toEqual([MONTH_T, "2026-04-01"]);
    expect(after.payees).toEqual(before.payees);
    expect(after.payees.some((p: Json) => p.system === "starting_balance")).toBe(true);
    expect(after.payees.find((p: Json) => p.name === "ZZ Grocer")).toMatchObject({
      fixed: "ZZ Food",
      dflt: "ZZ Rent",
    });
    expect(after.payees.find((p: Json) => p.name === "ZZ Hardware").hidden).toBe(1);
    expect(after.rules).toEqual(before.rules);
    expect(after.rules).toHaveLength(1);
    expect(after.views).toEqual(before.views);
    expect(after.views.find((v: Json) => v.name === "ZZ View").categories).toEqual([
      "ZZ Food",
      "ZZ Rent",
      "ZZ Loan Pay",
    ]);
    expect(after.schedules).toEqual(before.schedules);
    expect(after.schedules).toHaveLength(3);
    const split = after.schedules.find((x: Json) => x.memo === "ZZ split");
    expect(split.lines.map((l: Json) => [l.sort, l.category, l.payee])).toEqual([
      [0, "ZZ Food", "ZZ Split A"],
      [1, "ZZ Rent", "ZZ Split B"],
    ]);
    expect(after.schedules.find((x: Json) => x.memo === "ZZ transfer").transfer).toBe("ZZ Card");
    // write tokens are new, and no id is shared with the source
    const tokens = await q(
      "select write_token from scheduled_transactions where budget_id in (?, ?)",
      s.bid,
      nb,
    );
    expect(new Set(tokens.map((t) => t.write_token)).size).toBe(tokens.length);
    for (const t of [
      "accounts",
      "category_groups",
      "categories",
      "payees",
      "scheduled_transactions",
      "scheduled_subtransactions",
      "plan_views",
      "payee_rename_rules",
    ]) {
      expect(
        await n(
          `select count(*) n from ${t} a join ${t} b on a.id = b.id where a.budget_id = ? and b.budget_id = ?`,
          s.bid,
          nb,
        ),
      ).toBe(0);
    }
  });

  it("3: no transactions and no assigned amounts are copied", async () => {
    const s = await seedSource();
    const { new_budget_id: nb } = await freshOk(s.bid, `ZZ-TEST new ${rand()}`);
    const accounts = await q(
      "select id, name from accounts where budget_id = ? and deleted_at is null",
      nb,
    );
    expect(accounts).toHaveLength(4);
    for (const a of accounts) {
      const rows = await q(
        "select payee_name, amount from transactions where account_id = ? and deleted_at is null",
        a.id,
      );
      expect(rows).toEqual([{ payee_name: "Starting Balance", amount: 0 }]);
    }
    expect(await n("select count(*) n from transactions where budget_id = ?", nb)).toBe(4);
    // ids made in SQL are real v4 uuids: the API parses them with z.uuid()
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const t of [
      "transactions",
      "payee_rename_rules",
      "plan_views",
      "scheduled_subtransactions",
    ]) {
      const ids = await q(`select id from ${t} where budget_id = ?`, nb);
      expect(ids.length).toBeGreaterThan(0);
      for (const r of ids) expect(r.id, t).toMatch(v4);
    }
    const tokens = await q(
      "select write_token from scheduled_transactions where budget_id = ?",
      nb,
    );
    for (const r of tokens) expect(r.write_token).toMatch(v4);
    expect(await n("select count(*) n from month_categories where budget_id = ?", nb)).toBe(0);
    const month = (await data(await json(`/api/v1/budgets/${nb}/months/${MONTH_T}`))) as Json;
    const cats = month.groups.flatMap((g: Json) => g.categories) as Json[];
    expect(cats.length).toBeGreaterThan(5);
    expect(cats.every((c) => c.assigned === 0)).toBe(true);
  });

  it("4: $0 Starting Balances: dated today, cleared, approved, Ready to Assign for cash only", async () => {
    const s = await seedSource();
    await run("delete from payees where budget_id = ? and system = 'starting_balance'", s.bid);
    const { new_budget_id: nb } = await freshOk(s.bid, `ZZ-TEST new ${rand()}`);
    const sys = await q(
      "select id from payees where budget_id = ? and system = 'starting_balance' and deleted_at is null",
      nb,
    );
    expect(sys).toHaveLength(1);
    const rows = await q(
      "select a.name as account, a.type, t.* from transactions t join accounts a on a.id = t.account_id where t.budget_id = ? order by a.name",
      nb,
    );
    expect(rows.map((r) => r.account)).toEqual(["ZZ Card", "ZZ Checking", "ZZ Loan", "ZZ Savings"]);
    for (const r of rows) {
      expect(r).toMatchObject({
        amount: 0,
        date: T,
        payee_name: "Starting Balance",
        payee_id: sys[0]?.id,
        cleared: "cleared",
        approved: 1,
        category_id: null,
        deleted_at: null,
      });
      expect(r.inflow_to_ready_to_assign).toBe(
        r.type === "checking" || r.type === "savings" ? 1 : 0,
      );
    }
  });

  it("5: the archive is renamed and keeps everything", async () => {
    const s = await seedSource();
    const before = await snapshot(s.bid);
    const txBefore = await n(
      "select count(*) n from transactions where budget_id = ? and deleted_at is null",
      s.bid,
    );
    expect(txBefore).toBeGreaterThan(9);
    const [src] = await q("select name, updated_at from budgets where id = ?", s.bid);
    const { archived_budget_id } = await freshOk(s.bid, `ZZ-TEST new ${rand()}`);
    expect(archived_budget_id).toBe(s.bid);
    expect(await snapshot(s.bid)).toEqual(before);
    const [row] = await q("select name, updated_at, deleted_at from budgets where id = ?", s.bid);
    expect(row?.name).toBe(`${src?.name} (Archived on ${T})`);
    expect(row?.deleted_at).toBeNull();
    expect(row?.updated_at).not.toBe(src?.updated_at);
    const listed = await names();
    expect(listed).toContain(`${src?.name} (Archived on ${T})`);
    expect(listed.filter((x) => x.startsWith("ZZ-TEST new")).length).toBeGreaterThan(0);
    expect(
      await n(
        "select count(*) n from transactions where budget_id = ? and deleted_at is null",
        s.bid,
      ),
    ).toBe(txBefore);
    // a long name is cut to 100 characters
    const long = await seedSource();
    await run("update budgets set name = ? where id = ?", "L".repeat(99), long.bid);
    await freshOk(long.bid, `ZZ-TEST new ${rand()}`);
    const [l] = await q("select name from budgets where id = ?", long.bid);
    expect(l?.name).toBe(`${"L".repeat(75)} (Archived on ${T})`);
    expect(l?.name).toHaveLength(100);
  });

  it("6: the name clash is 422 and changes nothing", async () => {
    const s = await seedSource();
    const other = await seedSource();
    const planCount = (await plans()).length;
    const logCount = await n("select count(*) n from change_log");
    for (const name of [s.name, `  ${other.name.toLowerCase()}  `]) {
      const res = await freshStart(s.bid, { name, today: T });
      expect(res.status).toBe(422);
      const body = (await res.json()) as Json;
      expect(body.error.detail).toBe("The plan name already exists.");
    }
    const empty = await freshStart(s.bid, { name: "   ", today: T });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Json).error).toBeTruthy();
    expect((await plans()).length).toBe(planCount);
    expect((await q("select name from budgets where id = ?", s.bid))[0]?.name).toBe(s.name);
    expect(await n("select count(*) n from change_log")).toBe(logCount);
    // a deleted plan's name is free
    const gone = await seedSource();
    expect((await send(`/api/v1/budgets/${gone.bid}`, "DELETE")).status).toBe(200);
    expect((await freshStart(s.bid, { name: gone.name, today: T })).status).toBe(201);
  });

  it("7: an unknown or deleted plan is 404", async () => {
    expect((await freshStart(crypto.randomUUID(), { name: "ZZ-TEST x", today: T })).status).toBe(
      404,
    );
    const gone = await seedSource();
    await send(`/api/v1/budgets/${gone.bid}`, "DELETE");
    expect((await freshStart(gone.bid, { name: `ZZ-TEST ${rand()}`, today: T })).status).toBe(404);
  });

  it("8: change_log on both plans, one change set, not undoable", async () => {
    const s = await seedSource();
    const res = await freshStart(s.bid, { name: `ZZ-TEST new ${rand()}`, today: T });
    const cs = res.headers.get("Budget-Change-Set");
    expect(cs).toBeTruthy();
    const { new_budget_id: nb } = await data(res);
    const rows = async (bid: string) =>
      q(
        "select action, entity_type, change_set_id, actor from change_log where budget_id = ? and change_set_id = ? order by rowid",
        bid,
        cs,
      );
    const count = (list: Json[], action: string, type: string) =>
      list.filter((r) => r.action === action && r.entity_type === type).length;
    const nw = await rows(nb);
    expect(count(nw, "create", "budget")).toBe(1);
    expect(count(nw, "create", "fresh_start")).toBe(1);
    expect(count(nw, "create", "transaction")).toBe(4);
    const old = await rows(s.bid);
    expect(count(old, "update", "budget")).toBe(1);
    expect(count(old, "create", "fresh_start")).toBe(1);
    expect(old).toHaveLength(2);
    expect(nw).toHaveLength(6);
    expect(
      await n(
        "select count(*) n from change_log where budget_id in (?, ?) and change_set_id is null and created_at >= (select min(created_at) from change_log where change_set_id = ?)",
        s.bid,
        nb,
        cs,
      ),
    ).toBe(0);
    expect([...nw, ...old].every((r) => r.actor === actor)).toBe(true);
    const snap = await snapshot(s.bid);
    for (const bid of [s.bid, nb]) {
      const undo = await send(`/api/v1/budgets/${bid}/changes/${cs}/undo`, "POST");
      expect(undo.status).toBe(409);
      expect(((await undo.json()) as Json).error.name).toBe("undo_refused");
    }
    expect(await snapshot(s.bid)).toEqual(snap);
  });

  /** A DB whose write batch (the one with more than 20 statements) is preceded by `race`, for the first `times` writes. */
  function racingDb(times: number, race: (t: D1Database) => Promise<unknown>) {
    const real = env.DB;
    const state = { fired: 0 };
    const db = new Proxy(real, {
      get(t, k) {
        if (k === "batch") {
          return async (list: D1PreparedStatement[]) => {
            if (state.fired < times && list.length > 20) {
              state.fired++;
              await race(t);
            }
            return t.batch(list);
          };
        }
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    return { db, state };
  }

  const startAs = async (db: D1Database, bid: string) => {
    const { freshStartBudget } = await import("../src/services/fresh-start");
    return freshStartBudget({ ...env, DB: db } as Env, actor, bid, {
      name: `ZZ-TEST new ${rand()}`,
      stop_importing_in_archive: true,
      today: T,
    });
  };

  it("9: a plan changed between the read and the write, every time, is 409 and writes nothing", async () => {
    const s = await seedSource();
    const planCount = await n("select count(*) n from budgets");
    const { db, state } = racingDb(Number.POSITIVE_INFINITY, async (t) => {
      const now = new Date().toISOString();
      await t
        .prepare(
          "insert into categories (id, budget_id, group_id, name, sort_order, hidden, created_at, updated_at) values (?, ?, ?, 'ZZ Raced', 99, 0, ?, ?)",
        )
        .bind(crypto.randomUUID(), s.bid, s.group["ZZ Group A"], now, now)
        .run();
    });
    await expect(startAs(db, s.bid)).rejects.toThrow("modified concurrently");
    expect(state.fired).toBeGreaterThan(0);
    expect(await n("select count(*) n from budgets")).toBe(planCount);
    expect((await q("select name from budgets where id = ?", s.bid))[0]?.name).toBe(s.name);
  });

  it("9b: another plan created once between the read and the write does not fail the Fresh Start", async () => {
    const s = await seedSource();
    const planCount = await n("select count(*) n from budgets");
    const { db, state } = racingDb(1, async (t) => {
      const now = new Date().toISOString();
      await t
        .prepare("insert into budgets (id, name, created_at, updated_at) values (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), `ZZ-TEST other ${rand()}`, now, now)
        .run();
    });
    const done = await startAs(db, s.bid);
    expect(state.fired).toBe(1);
    expect(done.archived_budget_id).toBe(s.bid);
    // The other plan, the new plan; the source stays (renamed).
    expect(await n("select count(*) n from budgets")).toBe(planCount + 2);
  });

  it("10: scheduled entering works in the new plan; the archive is skipped by the due-job", async () => {
    const s = await seedSource();
    const { new_budget_id: nb } = await freshOk(s.bid, `ZZ-TEST new ${rand()}`);
    const day = "2026-03-21";
    const entered = await enterDue(env as Env, { budgetIds: [nb], day, actor });
    expect(entered.entered.length).toBeGreaterThanOrEqual(1);
    const old = await enterDue(env as Env, { budgetIds: [s.bid], day, actor });
    expect(old.entered).toEqual([]);
    expect(
      await n(
        "select count(*) n from transactions where budget_id = ? and date = '2026-03-20' and memo = 'ZZ plain'",
        nb,
      ),
    ).toBe(1);
    expect(
      await n(
        "select count(*) n from transactions where budget_id = ? and date = '2026-03-20' and memo = 'ZZ plain'",
        s.bid,
      ),
    ).toBe(0);
  });
});
