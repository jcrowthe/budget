import { describe, expect, it } from "vitest";
import { json } from "./helpers";
import {
  account,
  base,
  data,
  examplePlan,
  IE_ORDER,
  type Json,
  MAY_NOV,
  plan,
  post,
  send,
  TODAY,
} from "./report-example";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

const ie = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/income-expense?${q}`)).json()) as Json;
const txs = async (bid: string, q: string) =>
  (await data(await json(`${base(bid)}/reports/transactions?${q}`))).transactions as Json[];
async function mcp(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
}

const CSV = [
  '"Category","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Average","Total"',
  '"All Income Sources",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
  '"D8 Employer",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
  '"Total Income",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
  '"Uncategorized Transactions",0.00,0.00,0.00,0.00,-15.00,0.00,0.00,-2.14,-15.00',
  '"D8 Group",0.00,0.00,-165.00,-105.50,-160.24,-450.00,-55.00,-133.68,-935.74',
  '"D8 Hidden",0.00,0.00,0.00,0.00,0.00,-40.00,0.00,-5.71,-40.00',
  '"D8 Loan Pmt",0.00,0.00,0.00,0.00,0.00,-250.00,0.00,-35.71,-250.00',
  '"D8 Utilities",0.00,0.00,0.00,0.00,-60.25,0.00,0.00,-8.61,-60.25',
  '"D8 Fun",0.00,0.00,-45.00,-25.00,0.00,-30.00,0.00,-14.29,-100.00',
  '"D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49',
  '"Total Expenses",0.00,0.00,-165.00,-105.50,-175.24,-450.00,-55.00,-135.82,-950.74',
  '"Net Income",0.00,0.00,2835.00,2894.50,2824.76,2550.00,-55.00,1578.47,11049.26',
].join("\n");

describe("surface", () => {
  it("lists the paths and the tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/reports/income-expense",
        "/api/v1/budgets/{budget_id}/reports/income-expense/export",
      ]),
    );
    expect(await listedToolNames()).toContain("get_income_expense");
  });
});

describe("income v expense (the ticket's example)", () => {
  it("reproduces the worked table, with no Starting Balance or transfer", async () => {
    const { bid } = await examplePlan({ order: IE_ORDER });
    const r = (await ie(bid, MAY_NOV)).data;
    expect(r.income.payees).toHaveLength(1);
    expect(r.income.payees[0]).toMatchObject({
      name: "D8 Employer",
      average: 1714290,
      total: 12000000,
    });
    expect(r.expense.groups[0].categories.map((c: Json) => c.name)).toEqual([
      "D8 Hidden",
      "D8 Loan Pmt",
      "D8 Utilities",
      "D8 Fun",
      "D8 Food",
    ]);
    expect(r.expense.groups[0].categories[0].hidden).toBe(true);
    expect(r.expense.groups[0].categories[4].months).toEqual([
      0, 0, -120000, -80500, -99990, -130000, -55000,
    ]);
    expect([r.income.total.total, r.expense.total.total, r.net_income.total]).toEqual([
      12000000, -950740, 11049260,
    ]);
    expect(JSON.stringify(r)).not.toContain("Starting Balance");
  });

  it("MCP returns the REST object", async () => {
    const { bid } = await examplePlan({ order: IE_ORDER });
    const rest = (await ie(bid, MAY_NOV)).data;
    const body = await mcp("get_income_expense", {
      budget_id: bid,
      start_month: "2026-05-01",
      end_month: "2026-11-01",
    });
    expect(body.result.structuredContent).toEqual(rest);
  });

  it("exports the CSV, without a BOM", async () => {
    const { bid } = await examplePlan({ order: IE_ORDER });
    const res = await json(`${base(bid)}/reports/income-expense/export?${MAY_NOV}`);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="budget-reflect-income-expense-2026-11-15.csv"',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).not.toBe(0xef);
    expect(new TextDecoder().decode(bytes)).toBe(CSV);
  });

  it("without a range it is Last 3 Months, and one month only is 422", async () => {
    const { bid } = await examplePlan();
    const r = (await ie(bid, TODAY)).data;
    expect(r.months).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect((await json(`${base(bid)}/reports/income-expense?start_month=2026-06-01`)).status).toBe(
      422,
    );
  });
});

describe("the income rule (plan I)", () => {
  it("counts payees by line, adjustments and no-payee rows; never a Starting Balance or transfer", async () => {
    const bid = await plan();
    const chk = await account(bid, "I Checking", "checking", 1000000, "2026-10-01");
    const loan = await account(bid, "I Loan", "otherLiability", 500000, "2026-10-01");
    await post(bid, {
      account_id: chk,
      date: "2026-11-02",
      amount: 80000,
      payee_name: "I Parent",
      subtransactions: [
        { amount: 50000, inflow_to_ready_to_assign: true },
        { amount: 30000, payee_name: "I Line Payer", inflow_to_ready_to_assign: true },
      ],
    });
    await post(bid, {
      account_id: chk,
      date: "2026-11-03",
      amount: 100000,
      transfer_account_id: loan,
      inflow_to_ready_to_assign: true,
    });
    await post(bid, {
      account_id: chk,
      date: "2026-11-05",
      amount: 10000,
      inflow_to_ready_to_assign: true,
    });
    const adj = await send("POST", `${base(bid)}/accounts/${chk}/adjust-balance`, {
      balance: 1000000 + 80000 + 100000 + 10000 - 250000,
      today: "2026-11-15",
    });
    expect(adj.status).toBe(200);
    const q = `start_month=2026-11-01&end_month=2026-11-01&${TODAY}`;
    const r = (await ie(bid, q)).data;
    expect(r.income.payees.map((p: Json) => [p.name, p.total])).toEqual([
      ["I Line Payer", 30000],
      ["I Parent", 50000],
      ["Manual Balance Adjustment", -250000],
      ["(no payee)", 10000],
    ]);
    expect(r.income.payees[3].payee_id).toBeNull();
    expect(r.income.total.total).toBe(-160000);
    const none = await txs(bid, `${q}&income_payee_id=none`);
    expect(none.map((t) => t.amount)).toEqual([10000]);
    const manual = r.income.payees[2].payee_id;
    expect((await txs(bid, `${q}&income_payee_id=${manual}`)).map((t) => t.amount)).toEqual([
      -250000,
    ]);
  });
});

describe("reports/transactions selectors (design case 18)", () => {
  it("422 for none or two selectors, 404 for another plan's payee", async () => {
    const { bid, g } = await examplePlan();
    const other = await examplePlan();
    const payee = (
      await txs(other.bid, `start_month=2026-05-01&end_month=2026-11-01&income=true`)
    )[0];
    expect(payee).toBeTruthy();
    const otherPayees = (await data(await json(`${base(other.bid)}/payees`))).payees as Json[];
    const emp = otherPayees.find((p) => p.name === "D8 Employer");
    const get = (s: string) =>
      json(`${base(bid)}/reports/transactions?start_month=2026-05-01&end_month=2026-11-01${s}`);
    expect((await get("")).status).toBe(422);
    expect((await get("&income=true&expenses=true")).status).toBe(422);
    expect((await get(`&income_payee_id=${emp.id}`)).status).toBe(404);
    expect((await get(`&group_id=${g.id}&income=true`)).status).toBe(422);
    const bad = await mcp("list_report_transactions", {
      budget_id: bid,
      start_month: "2026-05-01",
      end_month: "2026-11-01",
      income: true,
      expenses: true,
    });
    expect(bad.result.isError).toBe(true);
  });

  it("expenses, income and a group with a category excluded", async () => {
    const { bid, g } = await examplePlan();
    const q = "start_month=2026-05-01&end_month=2026-11-01";
    expect(await txs(bid, `${q}&expenses=true`)).toHaveLength(13);
    const income = await txs(bid, `${q}&income=true`);
    expect(income).toHaveLength(4);
    expect(income.every((t) => t.payee_name === "D8 Employer" && t.category_id === null)).toBe(
      true,
    );
    const grp = await txs(bid, `${q}&group_id=${g.id}&excluded_category_ids=${g.ids["D8 Food"]}`);
    expect(grp.some((t) => t.category_id === g.ids["D8 Food"])).toBe(false);
    expect(grp).toHaveLength(6);
    const viaMcp = await mcp("list_report_transactions", {
      budget_id: bid,
      start_month: "2026-05-01",
      end_month: "2026-11-01",
      income: true,
    });
    expect(viaMcp.result.structuredContent.transactions).toHaveLength(4);
  });
});
