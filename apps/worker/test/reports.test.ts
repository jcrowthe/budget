import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

async function plan() {
  return (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
}
const base = (bid: string) => `/api/v1/budgets/${bid}`;
async function account(bid: string, name: string, type: string, balance: number, date: string) {
  const res = await json(
    `${base(bid)}/accounts`,
    { method: "POST" },
    { name, type, balance, date },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}
async function tx(bid: string, account_id: string, date: string, amount: number) {
  const res = await json(
    `${base(bid)}/transactions`,
    { method: "POST" },
    { account_id, date, amount },
  );
  expect(res.status).toBe(201);
}

/** The EXF-551 example data. */
async function example() {
  const bid = await plan();
  const sav = await account(bid, "D8 Savings", "savings", 500000, "2026-05-15");
  await tx(bid, sav, "2026-09-01", 200000);
  const chk = await account(bid, "D8 Checking", "checking", 2000000, "2026-06-01");
  const rows: [string, number][] = [
    ["2026-07-05", 3000000],
    ["2026-07-06", -120000],
    ["2026-07-07", -45000],
    ["2026-08-05", 3000000],
    ["2026-08-06", -80500],
    ["2026-08-07", -25000],
    ["2026-09-02", -200000],
    ["2026-09-03", -60250],
    ["2026-09-04", -99990],
    ["2026-09-05", 3000000],
    ["2026-09-06", -15000],
    ["2026-10-02", -250000],
    ["2026-10-03", -30000],
    ["2026-10-04", -150000],
    ["2026-10-05", 3000000],
    ["2026-10-06", 20000],
    ["2026-10-07", -40000],
    ["2026-11-03", -55000],
  ];
  for (const [d, a] of rows) await tx(bid, chk, d, a);
  const house = await account(bid, "D8 House", "otherAsset", 10000000, "2026-06-01");
  await tx(bid, house, "2026-10-31", 500000);
  const loan = await account(bid, "D8 Car Loan", "otherLiability", 5000000, "2026-06-01");
  await tx(bid, loan, "2026-10-01", 250000);
  return { bid, sav, chk, house, loan };
}
const nw = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/net-worth?${q}`)).json()) as Json;
const TODAY = "today=2026-11-15";

describe("reports", () => {
  it("lists its paths and tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/reports/range",
        "/api/v1/budgets/{budget_id}/reports/net-worth",
        "/api/v1/budgets/{budget_id}/reports/net-worth/export",
      ]),
    );
    expect(await listedToolNames()).toContain("get_net_worth");
  });

  it("range presets", async () => {
    const { bid } = await example();
    const range = async (q: string) =>
      ((await (await json(`${base(bid)}/reports/range?${q}`)).json()) as Json).data;
    expect(await range(`preset=all_dates&${TODAY}`)).toEqual({
      first_month: "2026-05-01",
      current_month: "2026-11-01",
      start_month: "2026-05-01",
      end_month: "2026-11-01",
    });
    expect((await range(`preset=last_year&${TODAY}`)).start_month).toBe("2026-05-01");
    expect((await range(`preset=last_year&${TODAY}`)).end_month).toBe("2026-05-01");
    expect((await range(`preset=last_3_months&${TODAY}`)).start_month).toBe("2026-09-01");
    expect(
      (await range("preset=custom&start_month=2026-07-01&end_month=2026-08-01&today=2026-11-15"))
        .end_month,
    ).toBe("2026-08-01");
    expect((await range("preset=this_month&today=2026-12-01")).current_month).toBe("2026-12-01");
    const empty = await plan();
    const e = (
      (await (await json(`${base(empty)}/reports/range?preset=all_dates&${TODAY}`)).json()) as Json
    ).data;
    expect([e.first_month, e.start_month, e.end_month]).toEqual([
      "2026-11-01",
      "2026-11-01",
      "2026-11-01",
    ]);
    expect((await json(`${base(bid)}/reports/range?preset=custom`)).status).toBe(422);
  });

  it("net worth May to Nov", async () => {
    const { bid } = await example();
    const { data } = await nw(bid, `start_month=2026-05-01&end_month=2026-11-01&${TODAY}`);
    expect(data.net_worth).toBe(19299260);
    expect(data.assets).toBe(24049260);
    expect(data.debts).toBe(-4750000);
    expect(data.change).toBe(18799260);
    expect(data.change_pct).toBe(3759.9);
    expect(data.months.map((m: Json) => m.net_worth)).toEqual([
      500000, 7500000, 10335000, 13229500, 16054260, 19354260, 19299260,
    ]);
    expect(data.months[6].accounts.map((a: Json) => [a.name, a.balance])).toEqual([
      ["D8 Savings", 700000],
      ["D8 Checking", 12849260],
      ["D8 House", 10500000],
      ["D8 Car Loan", -4750000],
    ]);
    const omitted = (await nw(bid, TODAY)).data;
    expect(omitted).toEqual(data);
  });

  it("net worth over sub-ranges and exclusions", async () => {
    const { bid, house, loan } = await example();
    const sepNov = (await nw(bid, `start_month=2026-09-01&end_month=2026-11-01&${TODAY}`)).data;
    expect([sepNov.change, sepNov.change_pct]).toEqual([3245000, 20.2]);
    const julSep = (await nw(bid, `start_month=2026-07-01&end_month=2026-09-01&${TODAY}`)).data;
    expect([
      julSep.net_worth,
      julSep.assets,
      julSep.debts,
      julSep.change,
      julSep.change_pct,
    ]).toEqual([16054260, 21054260, -5000000, 5719260, 55.3]);
    const ex = (await nw(bid, `excluded_account_ids=${house},${loan},nope&${TODAY}`)).data;
    expect(ex.net_worth).toBe(13549260);
    expect(ex.months[0].accounts.map((a: Json) => a.name)).toEqual(["D8 Savings", "D8 Checking"]);
  });

  it("422 for bad queries", async () => {
    const { bid } = await example();
    for (const q of [
      "start_month=2026-05-01",
      "start_month=2026-09-01&end_month=2026-05-01",
      "today=2026-02-30",
      "start_month=2026-05-02&end_month=2026-06-01",
    ]) {
      expect((await json(`${base(bid)}/reports/net-worth?${q}`)).status).toBe(422);
    }
    expect((await json(`${base(crypto.randomUUID())}/reports/net-worth`)).status).toBe(404);
  });

  it("a closed account sorts last", async () => {
    const { bid, chk } = await example();
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(chk).run();
    const { data } = await nw(bid, `${TODAY}`);
    expect(data.months[6].accounts.map((a: Json) => a.name)).toEqual([
      "D8 Savings",
      "D8 House",
      "D8 Car Loan",
      "D8 Checking",
    ]);
    const csv = await (await json(`${base(bid)}/reports/net-worth/export?${TODAY}`)).text();
    expect(csv.split("\n").map((l) => l.split(",")[0])).toEqual([
      '"Account"',
      '"D8 Savings"',
      '"D8 House"',
      '"D8 Car Loan"',
      '"D8 Checking"',
      '"Net Worth"',
    ]);
  });

  it("exports the CSV", async () => {
    const { bid } = await example();
    const res = await json(`${base(bid)}/reports/net-worth/export?${TODAY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="budget-reflect-net-worth-2026-11-15.csv"',
    );
    expect(await res.text()).toBe(
      [
        '"Account","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026"',
        '"D8 Savings",500.00,500.00,500.00,500.00,700.00,700.00,700.00',
        '"D8 Checking",0.00,2000.00,4835.00,7729.50,10354.26,12904.26,12849.26',
        '"D8 House",0.00,10000.00,10000.00,10000.00,10000.00,10500.00,10500.00',
        '"D8 Car Loan",0.00,-5000.00,-5000.00,-5000.00,-5000.00,-4750.00,-4750.00',
        '"Net Worth",500.00,7500.00,10335.00,13229.50,16054.26,19354.26,19299.26',
      ].join("\n"),
    );
  });

  it("get_net_worth returns what REST returns", async () => {
    const { bid } = await example();
    await mcpRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const rest = (await nw(bid, "start_month=2026-05-01&end_month=2026-11-01&today=2026-11-15"))
      .data;
    const { body } = await mcpRpc("tools/call", {
      name: "get_net_worth",
      arguments: { budget_id: bid, start_month: "2026-05-01", end_month: "2026-11-01" },
    });
    expect(body.result?.structuredContent).toEqual(rest);
  });

  it("a split counts once with the parent's amount, REST and tool", async () => {
    const bid = await plan();
    const chk = await account(bid, "D8 Split", "checking", 1000000, "2026-10-01");
    const res = await json(
      `${base(bid)}/transactions`,
      { method: "POST" },
      {
        account_id: chk,
        date: "2026-10-05",
        amount: -100000,
        subtransactions: [{ amount: -60000 }, { amount: -25000 }, { amount: -15000 }],
      },
    );
    expect(res.status).toBe(201);
    const q = "start_month=2026-10-01&end_month=2026-10-01&today=2026-11-15";
    const { data } = await nw(bid, q);
    expect(data.net_worth).toBe(900000);
    expect(data.months[0].accounts[0].balance).toBe(900000);
    await mcpRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const { body } = await mcpRpc("tools/call", {
      name: "get_net_worth",
      arguments: { budget_id: bid, start_month: "2026-10-01", end_month: "2026-10-01" },
    });
    expect(body.result?.structuredContent?.net_worth).toBe(900000);
  });

  it("a transfer between on-plan accounts moves money between accounts, not net worth", async () => {
    const bid = await plan();
    const a = await account(bid, "D8 From", "checking", 1000000, "2026-10-01");
    const b = await account(bid, "D8 To", "savings", 200000, "2026-10-01");
    const q = "start_month=2026-10-01&end_month=2026-10-01&today=2026-11-15";
    const before = (await nw(bid, q)).data;
    const res = await json(
      `${base(bid)}/transactions`,
      { method: "POST" },
      { account_id: a, date: "2026-10-05", amount: -50000, transfer_account_id: b },
    );
    expect(res.status).toBe(201);
    const after = (await nw(bid, q)).data;
    expect(after.net_worth).toBe(before.net_worth);
    const bal = (d: Json, id: string) =>
      d.months[0].accounts.find((x: Json) => x.id === id).balance;
    expect(bal(after, a)).toBe(bal(before, a) - 50000);
    expect(bal(after, b)).toBe(bal(before, b) + 50000);
  });
});
