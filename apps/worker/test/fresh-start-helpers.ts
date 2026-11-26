import { env } from "cloudflare:test";
import { expect } from "vitest";
import type { Env } from "../src/env";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { setTarget } from "../src/services/targets";
import { surfaceTool } from "./fresh-start-tool";
import { json } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
export type Json = any;
export const T = "2026-03-10";
export const PREV = "2026-02-01";
export const MONTH_T = "2026-03-01";
export const NEXT = "2026-04-01";
export const actor = "user:tester@localhost";

export const rand = () => crypto.randomUUID().slice(0, 8);
export const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
export const data = async (res: Response) => ((await res.json()) as Json).data;
export const q = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;
export const n = async (sql: string, ...b: unknown[]) => (await q(sql, ...b))[0]?.n as number;
export const run = (sql: string, ...b: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...b)
    .run();
export const tool = surfaceTool;

export const freshStart = (bid: string, body: Json, headers: Record<string, string> = {}) =>
  json(`/api/v1/budgets/${bid}/fresh-start`, { method: "POST", headers }, body);

export async function freshOk(bid: string, name: string, extra: Json = {}) {
  const res = await freshStart(bid, { name, today: T, ...extra });
  expect(res.status).toBe(201);
  return (await data(res)) as { new_budget_id: string; archived_budget_id: string };
}

export async function plans(): Promise<Json[]> {
  return (await data(await json("/api/v1/budgets"))).budgets;
}

export interface Source {
  bid: string;
  name: string;
  acct: Record<string, string>;
  cat: Record<string, string>;
  group: Record<string, string>;
}

/** Everything Fresh Start copies or leaves behind, in one plan (names `ZZ-TEST <random>`). */
export async function seedSource(
  opts: { environment?: "sandbox" | "production" } = {},
): Promise<Source> {
  const name = `ZZ-TEST ${rand()}`;
  const budget = await createBudget(env as Env, actor, {
    name,
    bank_environment: opts.environment ?? "production",
    currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
    date_format: { format: "DD.MM.YYYY" },
  });
  const bid = budget.id;
  const A = `/api/v1/budgets/${bid}`;
  await send(A, "PATCH", { expected_income: 4_000_000 });
  await send(A, "PATCH", { flag_names: { red: "ZZ Urgent", blue: "ZZ Later" } });

  const acct: Record<string, string> = {};
  const mkAccount = async (key: string, type: string, balance: number, extra: Json = {}) => {
    const res = await send(`${A}/accounts`, "POST", {
      name: `ZZ ${key}`,
      type,
      balance,
      date: "2026-02-10",
      ...extra,
    });
    expect(res.status).toBe(201);
    acct[key] = (await data(res)).account.id;
  };
  await mkAccount("Checking", "checking", 500_000);
  await mkAccount("Savings", "savings", 0);
  await mkAccount("Card", "creditCard", 0);
  await mkAccount("Loan", "studentLoan", 0, { interest_rate: "4.5", minimum_payment: 90_000 });

  const group: Record<string, string> = {};
  const cat: Record<string, string> = {};
  for (const g of ["ZZ Group A", "ZZ Group B"]) {
    group[g] = (await createCategoryGroup(env as Env, actor, { budget_id: bid, name: g })).id;
  }
  const mkCat = async (key: string, g: string) => {
    cat[key] = (
      await createCategory(env as Env, actor, {
        budget_id: bid,
        group_id: group[g] as string,
        name: key,
      })
    ).id;
  };
  await mkCat("ZZ Rent", "ZZ Group A");
  await mkCat("ZZ Food", "ZZ Group A");
  await mkCat("ZZ Fun", "ZZ Group B");
  await mkCat("ZZ Loan Pay", "ZZ Group B");
  await run(
    "update categories set hidden = 1, note = 'ZZ hidden note' where id = ?",
    cat["ZZ Fun"],
  );
  await run("update categories set note = 'ZZ rent note' where id = ?", cat["ZZ Rent"]);
  await run("update category_groups set hidden = 1 where id = ?", group["ZZ Group B"]);
  await run(
    "update accounts set paired_category_id = ?, note = 'ZZ loan note', starred = 1 where id = ?",
    cat["ZZ Loan Pay"],
    acct.Loan,
  );
  await run("update accounts set escrow_amount = 5000 where id = ?", acct.Loan);
  await send(`${A}/accounts/${acct.Savings}/close`, "POST", { today: "2026-02-11" });

  const tx = async (body: Json) => {
    const res = await send(`${A}/transactions`, "POST", {
      account_id: acct.Checking,
      date: "2026-03-02",
      inflow_to_ready_to_assign: false,
      ...body,
    });
    expect(res.status).toBe(201);
    return (await data(res)).transaction as Json;
  };
  await tx({ amount: -40_000, payee_name: "ZZ Grocer", category_id: cat["ZZ Food"] });
  const rec = await tx({ amount: -60_000, payee_name: "ZZ Landlord", category_id: cat["ZZ Rent"] });
  await run("update transactions set cleared = 'reconciled' where id = ?", rec.id);
  await tx({
    amount: -30_000,
    payee_name: "ZZ Hardware",
    subtransactions: [
      { amount: -10_000, category_id: cat["ZZ Food"], payee_name: "ZZ Line Payee" },
      { amount: -20_000, category_id: cat["ZZ Rent"] },
    ],
  });
  await tx({ amount: -25_000, transfer_account_id: acct.Card });
  const imp = await tx({ amount: -12_340, payee_name: "ZZ Imported", category_id: cat["ZZ Food"] });
  await run(
    "update transactions set source = 'plaid', import_id = ? where id = ?",
    `ZZ-IMP-${rand()}`,
    imp.id,
  );

  const targets: [string, Json][] = [
    ["ZZ Rent", { cadence: "monthly", behavior: "set_aside", amount: 100_000 }],
    ["ZZ Food", { cadence: "weekly", behavior: "refill", amount: 20_000, day_of_week: 1 }],
    [
      "ZZ Fun",
      { cadence: "yearly", behavior: "set_aside", amount: 50_000, due_date: "2026-12-25" },
    ],
  ];
  for (const [k, def] of targets) {
    const res = await send(`${A}/categories/${cat[k]}/target`, "PUT", def);
    expect(res.status).toBe(200);
  }
  await run("update targets set created_on = '2026-01-05' where budget_id = ?", bid);

  for (const [month, c] of [
    [PREV, "ZZ Rent"],
    [MONTH_T, "ZZ Rent"],
    [MONTH_T, "ZZ Food"],
    [NEXT, "ZZ Food"],
  ] as const) {
    await setAssigned(env as Env, actor, {
      budget_id: bid,
      month,
      category_id: cat[c] as string,
      assigned: 70_000,
    });
  }
  const now = new Date().toISOString();
  for (const month of [PREV, MONTH_T]) {
    await run(
      "insert into target_snoozes (budget_id, category_id, month, created_at) values (?, ?, ?, ?)",
      bid,
      cat["ZZ Rent"],
      month,
      now,
    );
  }
  for (const month of [PREV, MONTH_T, NEXT]) {
    await run(
      "insert into months (budget_id, month, note, updated_at) values (?, ?, ?, ?) on conflict(budget_id, month) do update set note = excluded.note",
      bid,
      month,
      `ZZ note ${month}`,
      now,
    );
  }

  const payeeId = async (nm: string) =>
    (
      await q(
        "select id from payees where budget_id = ? and name = ? and deleted_at is null",
        bid,
        nm,
      )
    )[0]?.id as string;
  await run(
    "update payees set fixed_category_id = ?, default_category_id = ?, category_mode = 'fixed' where id = ?",
    cat["ZZ Food"],
    cat["ZZ Rent"],
    await payeeId("ZZ Grocer"),
  );
  await run("update payees set hidden = 1 where id = ?", await payeeId("ZZ Hardware"));
  const rule = await send(`${A}/payees/${await payeeId("ZZ Grocer")}/rename-rules`, "POST", {
    kind: "is",
    text: "ZZ GROCER 123",
  });
  expect(rule.status).toBe(201);

  const view = await send(`${A}/views`, "POST", {
    name: "ZZ View",
    category_ids: [cat["ZZ Food"], cat["ZZ Rent"], cat["ZZ Loan Pay"]],
  });
  expect(view.status).toBe(201);

  const sched = async (body: Json) => {
    const res = await send(`${A}/scheduled-transactions?today=${T}`, "POST", {
      account_id: acct.Checking,
      date_first: "2026-03-20",
      frequency: "monthly",
      ...body,
    });
    expect(res.status, JSON.stringify(res.status === 201 ? "" : await res.clone().json())).toBe(
      201,
    );
    return (await data(res)).scheduled_transaction as Json;
  };
  await sched({
    amount: -15_000,
    payee_name: "ZZ Gym",
    category_id: cat["ZZ Fun"],
    memo: "ZZ plain",
    flag_color: "red",
  });
  await sched({ amount: -50_000, transfer_account_id: acct.Card, memo: "ZZ transfer" });
  await sched({
    amount: -30_000,
    payee_name: "ZZ Market",
    memo: "ZZ split",
    subtransactions: [
      { amount: -10_000, category_id: cat["ZZ Food"], payee_name: "ZZ Split A", memo: "a" },
      { amount: -20_000, category_id: cat["ZZ Rent"], payee_name: "ZZ Split B", memo: "b" },
    ],
  });
  return { bid, name, acct, cat, group };
}

/** One plan as natural keys (names instead of ids), for comparing a copy with its source or two copies. */
export async function dump(bid: string, opts: { startingBalances?: boolean } = {}): Promise<Json> {
  const [b] = await q(
    "select bank_environment, currency_iso_code, number_format, symbol_placement, date_format, expected_income, flag_names from budgets where id = ?",
    bid,
  );
  const out: Json = { budget: b };
  out.accounts = await q(
    `select a.name, a.type, a.on_budget, a.note, a.starred, a.closed, a.sort_order, a.interest_rate, a.minimum_payment,
       a.escrow_amount, a.last_reconciled_at, (select name from categories where id = a.paired_category_id) as paired
     from accounts a where a.budget_id = ? and a.deleted_at is null order by a.name`,
    bid,
  );
  out.groups = await q(
    "select name, sort_order, hidden, kind from category_groups where budget_id = ? and deleted_at is null order by name",
    bid,
  );
  out.categories = await q(
    `select c.name, g.name as group_name, c.sort_order, c.hidden, c.note, c.kind, (select name from accounts where id = c.account_id) as account
     from categories c join category_groups g on g.id = c.group_id where c.budget_id = ? and c.deleted_at is null order by c.name`,
    bid,
  );
  out.targets = await q(
    `select c.name as category, t.cadence, t.behavior, t.amount, t.day_of_week, t.day_of_month, t.due_date, t.due_month, t.repeat_every, t.repeat_unit, t.created_on
     from targets t join categories c on c.id = t.category_id where t.budget_id = ? order by c.name`,
    bid,
  );
  out.snoozes = await q(
    "select c.name as category, s.month from target_snoozes s join categories c on c.id = s.category_id where s.budget_id = ? order by c.name, s.month",
    bid,
  );
  out.months = await q("select month, note from months where budget_id = ? order by month", bid);
  out.payees = await q(
    `select p.name, p.hidden, p.system, p.category_mode, p.fixed_inflow_to_ready_to_assign as fixed_rta, p.default_inflow_to_ready_to_assign as default_rta,
       (select name from categories where id = p.fixed_category_id) as fixed, (select name from categories where id = p.default_category_id) as dflt
     from payees p where p.budget_id = ? and p.deleted_at is null order by p.system, p.name`,
    bid,
  );
  out.rules = await q(
    "select p.name as payee, r.kind, r.text, r.match_text from payee_rename_rules r join payees p on p.id = r.payee_id where r.budget_id = ? and r.deleted_at is null order by p.name, r.text",
    bid,
  );
  const views = await q(
    "select builtin_key, name, category_ids, sort_order from plan_views where budget_id = ? and deleted_at is null order by sort_order",
    bid,
  );
  out.views = [];
  for (const v of views) {
    const ids = JSON.parse(v.category_ids) as string[];
    const names: string[] = [];
    for (const id of ids)
      names.push(
        (await q("select name from categories where id = ? and budget_id = ?", id, bid))[0]?.name ??
          `MISSING:${id}`,
      );
    out.views.push({
      builtin_key: v.builtin_key,
      name: v.name,
      sort_order: v.sort_order,
      categories: names,
    });
  }
  const schedules = await q(
    `select s.id, s.date_first, s.date_next, s.frequency, s.amount, s.inflow_to_ready_to_assign as rta, s.memo, s.flag_color,
       (select name from accounts where id = s.account_id) as account, (select name from accounts where id = s.transfer_account_id) as transfer,
       (select name from payees where id = s.payee_id) as payee, (select name from categories where id = s.category_id) as category
     from scheduled_transactions s where s.budget_id = ? and s.deleted_at is null order by s.memo`,
    bid,
  );
  out.schedules = [];
  for (const s of schedules) {
    const { id, ...rest } = s;
    const lines = await q(
      `select l.amount, l.memo, l.sort, l.inflow_to_ready_to_assign as rta, (select name from payees where id = l.payee_id) as payee, (select name from categories where id = l.category_id) as category
       from scheduled_subtransactions l where l.scheduled_transaction_id = ? and l.deleted_at is null order by l.sort`,
      id,
    );
    out.schedules.push({ ...rest, lines });
  }
  if (opts.startingBalances) {
    out.transactions = await q(
      `select (select name from accounts where id = t.account_id) as account, t.date, t.amount, t.payee_name, t.cleared, t.approved, t.inflow_to_ready_to_assign as rta,
         (select name from categories where id = t.category_id) as category, (select system from payees where id = t.payee_id) as payee_system
       from transactions t where t.budget_id = ? and t.deleted_at is null order by account, t.date, t.amount, t.payee_name, t.memo`,
      bid,
    );
  }
  return out;
}

/** `select *` of the tables the archive must keep byte for byte, ordered by id. */
export async function snapshot(bid: string): Promise<Json> {
  const out: Json = {};
  for (const [t, order] of [
    ["transactions", "id"],
    ["month_categories", "category_id, month"],
    ["scheduled_transactions", "id"],
    ["scheduled_subtransactions", "id"],
    ["months", "month"],
    ["target_snoozes", "category_id, month"],
    ["targets", "category_id"],
    ["categories", "id"],
    ["category_groups", "id"],
    ["payees", "id"],
    ["payee_rename_rules", "id"],
    ["plan_views", "id"],
  ] as const) {
    out[t] = await q(`select * from ${t} where budget_id = ? order by ${order}`, bid);
  }
  out.accounts = await q("select * from accounts where budget_id = ? order by id", bid);
  return out;
}
