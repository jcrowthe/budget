import { describe, expect, it } from "vitest";
import { json } from "./helpers";
import {
  account,
  base,
  data,
  examplePlan,
  group,
  IE_ORDER,
  type Json,
  MAY_NOV,
  plan,
  post,
  TODAY,
  unzip,
} from "./report-example";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

const trends = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/spending-trends?${q}`)).json()) as Json;
const ie = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/income-expense?${q}`)).json()) as Json;
const sb = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/spending-breakdown?${q}`)).json()) as Json;
async function mcp(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
}

describe("surface", () => {
  it("lists the paths and the tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/reports/spending-trends",
        "/api/v1/budgets/{budget_id}/reports/spending-trends/export",
      ]),
    );
    expect(await listedToolNames()).toContain("get_spending_trends");
  });
});

describe("spending trends (the ticket's example)", () => {
  it("May–Nov: 950740 and 135820, with every comparison", async () => {
    const { bid } = await examplePlan();
    const r = (await trends(bid, MAY_NOV)).data;
    expect([r.total, r.average_monthly]).toEqual([950740, 135820]);
    expect(r.months.map((m: Json) => m.total)).toEqual([
      0, 0, 165000, 105500, 175240, 450000, 55000,
    ]);
    expect(
      r.months.map((m: Json) => [m.month.slice(5, 7), m.compared_to_average, m.compared_pct]),
    ).toEqual([
      ["05", -135820, 100],
      ["06", -135820, 100],
      ["07", 29180, 21.5],
      ["08", -30320, 22.3],
      ["09", 39420, 29],
      ["10", 314180, 231.3],
      ["11", -80820, 59.5],
    ]);
    expect(r.months[5].series).toEqual([
      { id: expect.any(String), name: "D8 Group", amount: 450000, share_pct: 100 },
    ]);
  });

  it("with no range it is Last 3 Months from today", async () => {
    const { bid } = await examplePlan();
    const r = (await trends(bid, TODAY)).data;
    expect([r.start_month, r.end_month]).toEqual(["2026-09-01", "2026-11-01"]);
    expect([r.total, r.average_monthly]).toEqual([680240, 226750]);
  });

  it("drills into a group, and a group of another plan is 404", async () => {
    const { bid, g } = await examplePlan();
    const other = await examplePlan();
    const r = (await trends(bid, `${MAY_NOV}&group_id=${g.id}`)).data;
    expect([r.total, r.average_monthly]).toEqual([935740, 133680]);
    expect(r.group).toEqual({ id: g.id, name: "D8 Group" });
    expect(r.months[5].series.map((s: Json) => [s.name, s.amount, s.share_pct])).toEqual([
      ["D8 Food", 130000, 28.9],
      ["D8 Loan Pmt", 250000, 55.6],
      ["D8 Fun", 30000, 6.7],
      ["D8 Hidden", 40000, 8.9],
    ]);
    const res = await json(
      `${base(bid)}/reports/spending-trends?${MAY_NOV}&group_id=${other.g.id}`,
    );
    expect(res.status).toBe(404);
  });

  it("one month only is 422", async () => {
    const { bid } = await examplePlan();
    const res = await json(`${base(bid)}/reports/spending-trends?start_month=2026-06-01`);
    expect(res.status).toBe(422);
  });

  it("a net inflow is a negative segment and a split's lines sit in their own groups (plan T)", async () => {
    const bid = await plan();
    const needs = await group(bid, "T Needs", ["T Food"]);
    const wants = await group(bid, "T Wants", ["T Fun"]);
    const chk = await account(bid, "T Checking", "checking", 1000000, "2026-10-01");
    await post(bid, {
      account_id: chk,
      date: "2026-11-04",
      amount: -100000,
      payee_name: "T Market",
      subtransactions: [
        { amount: -60000, category_id: needs.ids["T Food"] },
        { amount: -40000, category_id: wants.ids["T Fun"] },
      ],
    });
    await post(bid, { account_id: chk, date: "2026-11-06", amount: 50000, payee_name: "T Refund" });
    const r = (await trends(bid, `start_month=2026-11-01&end_month=2026-11-01&${TODAY}`)).data;
    expect(r.months[0].series.map((s: Json) => [s.name, s.amount])).toEqual([
      ["T Needs", 60000],
      ["T Wants", 40000],
      ["Uncategorized Transactions", -50000],
    ]);
    expect([r.total, r.average_monthly, r.months[0].total]).toEqual([50000, 50000, 50000]);
  });

  it("MCP returns the REST object", async () => {
    const { bid } = await examplePlan();
    const rest = (await trends(bid, MAY_NOV)).data;
    const body = await mcp("get_spending_trends", {
      budget_id: bid,
      start_month: "2026-05-01",
      end_month: "2026-11-01",
    });
    expect(body.result.structuredContent).toEqual(rest);
  });
});

describe("spending trends export", () => {
  it("is a ZIP of two CSVs with a BOM, LF and no final newline", async () => {
    const { bid } = await examplePlan();
    const res = await json(`${base(bid)}/reports/spending-trends/export?${MAY_NOV}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="budget-reflect-spending-trends-2026-11-15.zip"',
    );
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual([
      "budget-reflect-spending-trends-2026-11-15.csv",
      "budget-reflect-spending-trends-2026-11-15-transactions.csv",
    ]);
    const [summary, trans] = [...files.values()].map((b) =>
      new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(b),
    ) as [string, string];
    for (const t of [summary, trans]) {
      expect(t.startsWith("﻿")).toBe(true);
      expect(t).not.toContain("\r");
      expect(t.endsWith("\n")).toBe(false);
    }
    expect(summary.split("\n")).toContain(
      '"D8 Group","D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49',
    );
    expect(trans.split("\n")).toHaveLength(14);
  });
});

describe("Income v Expense equals Spending Breakdown and Trends (design case 16)", () => {
  it("expense total is minus the breakdown total, with and without exclusions", async () => {
    const { bid, sav } = await examplePlan({ order: IE_ORDER });
    for (const start of ["2026-06-01", "2026-05-01"]) {
      for (const extra of [
        "",
        `&excluded_category_ids=uncategorized&excluded_account_ids=${sav}`,
      ]) {
        const q = `start_month=${start}&end_month=2026-11-01&${TODAY}${extra}`;
        const expense = (await ie(bid, q)).data.expense.total.total;
        expect(expense).toBe(-(await sb(bid, q)).data.total);
        expect(expense).toBe(-(await trends(bid, q)).data.total);
      }
    }
  });
});
