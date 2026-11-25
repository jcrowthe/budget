import { env } from "cloudflare:test";
import { DEBT_TARGET_TYPE } from "@budget/core/debt-targets";
import { TargetType } from "@budget/schema/targets";
import { describe, expect, it } from "vitest";
import { setAssigned } from "../src/services/months";
import { account, actor, type Json, plan, q, send } from "./bulk-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// EXF-545: the Debt Payment Target of a loan's paired category, and the month read's paired_account_id and
// paid_this_month. The ticket's mortgage: 200,000.00 at 6%, minimum 1,500.00, escrow 300.00.

const NOV = "2026-11-01";
const DEC = "2026-12-01";
const TODAY = "2026-11-15";

const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
};

async function world() {
  const b = await plan();
  const api = (p: string) => `/api/v1/budgets/${b}${p}`;
  const checking = await account(b, "checking", 100000000);
  const openLoan = async (extra: Json) => {
    const res = await send(api("/accounts"), "POST", {
      name: `ZZ-TEST Mortgage ${crypto.randomUUID().slice(0, 6)}`,
      type: "mortgage",
      balance: 200000000,
      interest_rate: "6",
      minimum_payment: 1500000,
      escrow_amount: 300000,
      date: "2026-11-01",
      ...extra,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.account as Json;
  };
  const loan = await openLoan({
    new_category: { name: "ZZ-TEST Pay", new_group_name: "ZZ-TEST Loans" },
  });
  const read = async (m = NOV): Promise<Json> =>
    ((await (await json(api(`/months/${m}?today=${TODAY}`))).json()) as Json).data;
  const cats = async (m = NOV) => (await read(m)).groups.flatMap((g: Json) => g.categories);
  const cat = async (m = NOV) =>
    (await cats(m)).find((c: Json) => c.id === loan.paired_category_id) as Json;
  const ordinary = (
    (await cats()).find((c: Json) => c.kind === null && c.id !== loan.paired_category_id) as Json
  ).id as string;
  const card = (
    await send(api("/accounts"), "POST", {
      name: "ZZ-TEST Card",
      type: "creditCard",
      balance: 100000,
      date: "2026-11-02",
    })
  ).status;
  expect(card).toBe(201);
  const payCat = ((await cats()).find((c: Json) => c.kind === "credit_card_payment") as Json)
    .id as string;
  const put = (body: unknown, category: string = loan.paired_category_id) =>
    send(api(`/categories/${category}/target?today=${TODAY}`), "PUT", body);
  const assign = (assigned: number, m = NOV) =>
    setAssigned(env, actor, {
      budget_id: b,
      month: m,
      category_id: loan.paired_category_id,
      assigned,
    });
  const rta = async () => (await read()).ready_to_assign as number;
  const targetLogs = () =>
    q(
      "select action, before, after from change_log where budget_id = ? and entity_type = 'target' order by rowid",
      b,
    );
  const stored = () => q("select * from targets where budget_id = ?", b);
  const target = async (res: Response) => ((await res.json()) as Json).data.target as Json;
  return {
    b,
    api,
    checking,
    loan,
    openLoan,
    read,
    cats,
    cat,
    ordinary,
    payCat,
    put,
    assign,
    rta,
    targetLogs,
    stored,
    target,
  };
}

const DEBT = { type: "debt_payment", amount: 1500000, day: "last" };

describe("setting a Debt Payment Target", () => {
  it("is a monthly set-aside of the amount; the month read shows it", async () => {
    const w = await world();
    const res = await w.put(DEBT);
    expect(res.status).toBe(200);
    const t = await w.target(res);
    expect(t).toMatchObject({
      type: "debt_payment",
      cadence: "monthly",
      behavior: "set_aside",
      amount: 1500000,
      day_of_month: null,
    });
    expect(DEBT_TARGET_TYPE).toBe("debt_payment");
    expect(TargetType.options).toContain(DEBT_TARGET_TYPE);
    const c = await w.cat();
    expect(c.target).toMatchObject({
      needed_this_month: 1500000,
      period_due_date: "2026-11-30",
      status: "underfunded",
    });
    await w.assign(1500000);
    expect((await w.cat()).target.status).toBe("funded");
    const day15 = await w.target(await w.put({ ...DEBT, day: 15 }));
    expect(day15.day_of_month).toBe(15);
  });

  it("is refused for an unpaired category, a payment category and a closed loan's category", async () => {
    const w = await world();
    const closed = await w.openLoan({
      new_category: { name: "ZZ-TEST Closed Pay", new_group_name: "ZZ-TEST Loans" },
    });
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(closed.id).run();
    const logsBefore = (await q("select count(*) n from change_log where budget_id = ?", w.b))[0].n;
    for (const category of [w.ordinary, w.payCat, closed.paired_category_id]) {
      const res = await w.put(DEBT, category);
      expect(res.status).toBe(422);
      expect(((await res.json()) as Json).error.code).toBe("debt_target_requires_loan_category");
    }
    for (const bad of [
      { ...DEBT, amount: 0 },
      { ...DEBT, day: 0 },
      { ...DEBT, day: 32 },
      { ...DEBT, day: "first" },
    ]) {
      const res = await w.put(bad);
      expect(res.status).toBe(422);
      expect(((await res.json()) as Json).error.code).toBe("unprocessable_entity");
    }
    expect(await w.stored()).toHaveLength(0);
    expect((await q("select count(*) n from change_log where budget_id = ?", w.b))[0].n).toBe(
      logsBefore,
    );
  });

  it("logs one target row per write, without the type", async () => {
    const w = await world();
    await w.put(DEBT);
    await w.put({ ...DEBT, amount: 1600000 });
    const logs = await w.targetLogs();
    expect(logs.map((l: Json) => l.action)).toEqual(["create", "update"]);
    for (const l of logs) {
      expect(JSON.parse(l.after)).not.toHaveProperty("type");
      expect(JSON.parse(l.after)).toMatchObject({ cadence: "monthly", behavior: "set_aside" });
    }
    expect(JSON.parse(logs[1].before).amount).toBe(1500000);
  });

  it("is the type of any monthly set-aside on the paired category; delete says so too", async () => {
    const w = await world();
    const monthly = { cadence: "monthly", behavior: "set_aside", amount: 900000 };
    expect((await w.target(await w.put(monthly))).type).toBe("debt_payment");
    const weekly = { cadence: "weekly", behavior: "set_aside", amount: 900000, day_of_week: 1 };
    expect((await w.target(await w.put(weekly))).type).toBeNull();
    await w.put(DEBT);
    const del = await send(w.api(`/categories/${w.loan.paired_category_id}/target`), "DELETE");
    expect(((await del.json()) as Json).data.deleted.type).toBe("debt_payment");
  });
});

describe("the month read: paired_account_id and paid_this_month", () => {
  it("names the loan on the paired category only; the first created of two loans wins", async () => {
    const w = await world();
    expect((await w.cat()).paired_account_id).toBe(w.loan.id);
    expect((await w.cats()).filter((c: Json) => c.paired_account_id !== null)).toHaveLength(1);
    expect((await w.cats()).find((c: Json) => c.id === w.ordinary).paired_account_id).toBeNull();
    await w.openLoan({ paired_category_id: w.loan.paired_category_id });
    expect((await w.cat()).paired_account_id).toBe(w.loan.id);
  });

  it("paid_this_month is the month's payments", async () => {
    const w = await world();
    expect((await w.cat()).paid_this_month).toBe(0);
    await w.assign(1500000);
    const res = await send(w.api(`/accounts/${w.loan.id}/payments`), "POST", {
      from_account_id: w.checking,
      amount: 1500000,
      date: "2026-11-15",
    });
    expect(res.status).toBe(201);
    expect((await w.cat()).paid_this_month).toBe(1500000);
    expect((await w.cat(DEC)).paid_this_month).toBe(0);
  });
});

describe("Ready to Assign", () => {
  it("is unchanged by the target and by the payment; assigning lowers it", async () => {
    const w = await world();
    const start = await w.rta();
    await w.put(DEBT);
    expect(await w.rta()).toBe(start);
    await w.assign(1500000);
    expect(await w.rta()).toBe(start - 1500000);
    const res = await send(w.api(`/accounts/${w.loan.id}/payments`), "POST", {
      from_account_id: w.checking,
      amount: 1500000,
      date: "2026-11-15",
    });
    expect(res.status).toBe(201);
    expect(await w.rta()).toBe(start - 1500000);
    expect(await w.cat()).toMatchObject({
      cash_spending: -1500000,
      available: 0,
      activity: -1500000,
    });
  });
});

describe("MCP parity", () => {
  const strip = (t: Json) => {
    const { created_month: _c, ...rest } = t;
    return rest;
  };
  it("set_debt_payment_target returns REST's target; refusals are tool errors with the same text", async () => {
    const w = await world();
    const rest = await w.target(await w.put(DEBT));
    const r = await mcp("set_debt_payment_target", {
      budget_id: w.b,
      category_id: w.loan.paired_category_id,
      amount: 1500000,
      day: "last",
      today: TODAY,
    });
    expect(r.isError).toBeFalsy();
    expect(strip(r.structuredContent.target)).toEqual(strip(rest));
    const before = (await w.targetLogs()).length;
    const refusedRest = await w.put(DEBT, w.ordinary);
    const refusedMcp = await mcp("set_debt_payment_target", {
      budget_id: w.b,
      category_id: w.ordinary,
      amount: 1500000,
      day: "last",
    });
    expect(refusedMcp.isError).toBe(true);
    const detail = ((await refusedRest.json()) as Json).error.detail as string;
    expect(JSON.stringify(refusedMcp.content)).toContain(detail);
    expect((await w.targetLogs()).length).toBe(before);
  });
  it("get_plan_month carries the same figures as REST", async () => {
    const w = await world();
    const m = await mcp("get_plan_month", { budget_id: w.b, month: NOV, today: TODAY });
    const c = m.structuredContent.groups
      .flatMap((g: Json) => g.categories)
      .find((x: Json) => x.id === w.loan.paired_category_id);
    const rest = await w.cat();
    expect([c.paired_account_id, c.paid_this_month]).toEqual([
      rest.paired_account_id,
      rest.paid_this_month,
    ]);
  });
  it("the surface: the PUT path is unchanged and the tool is listed", async () => {
    const paths = await apiPaths();
    expect(paths).toContain("/api/v1/budgets/{budget_id}/categories/{category_id}/target");
    expect(await listedToolNames()).toContain("set_debt_payment_target");
  });
});
