import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const base = (bid: string) => `/api/v1/budgets/${bid}`;
const send = (method: string, url: string, body?: unknown) => json(url, { method }, body);
const data = async (res: Response) => ((await res.json()) as Json).data;
const TODAY = "today=2026-11-15";
const JUN_NOV = `start_month=2026-06-01&end_month=2026-11-01&${TODAY}`;

async function plan() {
  return (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
}
async function account(bid: string, name: string, type: string, balance: number, date: string) {
  const res = await send("POST", `${base(bid)}/accounts`, { name, type, balance, date });
  expect(res.status).toBe(201);
  return (await data(res)).account.id as string;
}
async function post(bid: string, body: unknown) {
  const res = await send("POST", `${base(bid)}/transactions`, body);
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
}
async function group(bid: string, name: string, cats: string[]) {
  const g = (await data(await send("POST", `${base(bid)}/category_groups`, { name })))
    .category_group;
  const ids: Record<string, string> = {};
  // A new category goes first in its group: create them last to first so the listed order is the plan order.
  for (const c of [...cats].reverse()) {
    const res = await send("POST", `${base(bid)}/categories`, { group_id: g.id, name: c });
    expect(res.status).toBe(201);
    ids[c] = (await data(res)).category.id;
  }
  return { id: g.id as string, ids };
}

/** The EXF-549 example. */
async function example() {
  const bid = await plan();
  const g = await group(bid, "D8 Group", [
    "D8 Food",
    "D8 Fun",
    "D8 Utilities",
    "D8 Loan Pmt",
    "D8 Hidden",
  ]);
  const sav = await account(bid, "D8 Savings", "savings", 500000, "2026-05-15");
  const chk = await account(bid, "D8 Checking", "checking", 2000000, "2026-06-01");
  const loan = await account(bid, "D8 Car Loan", "otherLiability", 5000000, "2026-06-01");
  const c = g.ids;
  const spend = (date: string, payee: string, cat: string | null, amount: number, extra = {}) =>
    post(bid, {
      account_id: chk,
      date,
      amount,
      payee_name: payee,
      ...(cat ? { category_id: c[cat] } : {}),
      ...extra,
    });
  const income = (date: string) =>
    post(bid, {
      account_id: chk,
      date,
      amount: 3000000,
      payee_name: "D8 Employer",
      inflow_to_ready_to_assign: true,
    });
  await spend("2026-07-10", "D8 Grocer", "D8 Food", -120000, { memo: "weekly shop" });
  await income("2026-07-15");
  await spend("2026-07-22", "D8 Cinema", "D8 Fun", -45000);
  await spend("2026-08-05", "D8 Grocer", "D8 Food", -80500);
  await income("2026-08-15");
  await spend("2026-08-20", "D8 Cinema", "D8 Fun", -25000);
  await post(bid, {
    account_id: chk,
    date: "2026-09-01",
    amount: -200000,
    transfer_account_id: sav,
  });
  await spend("2026-09-03", "D8 Power Co", "D8 Utilities", -60250);
  await spend("2026-09-12", "D8 Grocer", "D8 Food", -99990);
  await income("2026-09-15");
  await spend("2026-09-20", "D8 Mystery", null, -15000);
  await post(bid, {
    account_id: chk,
    date: "2026-10-01",
    amount: -250000,
    transfer_account_id: loan,
    category_id: c["D8 Loan Pmt"],
  });
  await spend("2026-10-07", "D8 Cinema", "D8 Fun", -30000);
  await spend("2026-10-09", "D8 Grocer", "D8 Food", -150000);
  await income("2026-10-15");
  await spend("2026-10-21", "D8 Grocer", "D8 Food", 20000, { memo: "refund" });
  await spend("2026-10-25", "D8 Gift Shop", "D8 Hidden", -40000);
  await spend("2026-11-03", "D8 Grocer", "D8 Food", -55000);
  const hid = await send("PATCH", `${base(bid)}/categories/${c["D8 Hidden"]}`, { hidden: true });
  expect(hid.status).toBe(200);
  return { bid, chk, sav, loan, g };
}

/** Plan S: the split case. */
async function splitPlan() {
  const bid = await plan();
  const g = await group(bid, "S Group", ["S Food", "S Fun"]);
  const chk = await account(bid, "S Checking", "checking", 1000000, "2026-10-01");
  const sav = await account(bid, "S Savings", "savings", 100000, "2026-10-01");
  const loan = await account(bid, "S Loan", "otherLiability", 500000, "2026-10-01");
  const food = g.ids["S Food"];
  const fun = g.ids["S Fun"];
  await post(bid, {
    account_id: chk,
    date: "2026-11-04",
    amount: -100000,
    payee_name: "S Market",
    subtransactions: [
      { amount: -60000, category_id: food },
      { amount: -40000, category_id: fun },
    ],
  });
  await post(bid, {
    account_id: chk,
    date: "2026-11-06",
    amount: -30000,
    payee_name: "S Shop",
    subtransactions: [
      { amount: -20000, category_id: food, memo: "line memo" },
      { amount: -10000, payee_name: "S Line Payee" },
    ],
  });
  await post(bid, {
    account_id: chk,
    date: "2026-11-07",
    amount: -200000,
    transfer_account_id: sav,
  });
  await post(bid, {
    account_id: chk,
    date: "2026-11-08",
    amount: -15000,
    payee_name: "S Shop",
    category_id: food,
  });
  await post(bid, {
    account_id: chk,
    date: "2026-11-09",
    amount: -55000,
    transfer_account_id: loan,
  });
  return { bid, chk, g };
}

const sb = async (bid: string, q: string) =>
  (await (await json(`${base(bid)}/reports/spending-breakdown?${q}`)).json()) as Json;
const txs = async (bid: string, q: string) =>
  (await data(await json(`${base(bid)}/reports/transactions?${q}`))).transactions as Json[];
async function mcp(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  const { body } = await mcpRpc("tools/call", { name, arguments: args }, 2);
  return body as Json;
}

/** A small local-header walker: the stored files of a ZIP by name. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLen));
    out.set(name, bytes.slice(p + 30 + nameLen, p + 30 + nameLen + size));
    p += 30 + nameLen + size;
  }
  return out;
}

describe("surface", () => {
  it("lists its paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/reports/spending-breakdown",
        "/api/v1/budgets/{budget_id}/reports/spending-breakdown/export",
        "/api/v1/budgets/{budget_id}/reports/transactions",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["get_spending_breakdown", "list_report_transactions"]),
    );
  });
});

describe("spending breakdown (the ticket's example)", () => {
  it("Jun–Nov, May–Nov, groups, the drill, exclusions", async () => {
    const { bid, chk, g } = await example();
    const r = await sb(bid, JUN_NOV);
    expect(r.data.total).toBe(950740);
    expect(r.data.items.map((i: Json) => [i.name, i.total, i.share_pct])).toEqual([
      ["D8 Food", 485490, 51],
      ["D8 Loan Pmt", 250000, 26],
      ["D8 Fun", 100000, 11],
      ["D8 Utilities", 60250, 6],
      ["D8 Hidden", 40000, 4],
      ["Uncategorized", 15000, 2],
    ]);
    expect([r.data.months, r.data.days, r.data.average_monthly, r.data.average_daily]).toEqual([
      6, 183, 158460, 5200,
    ]);
    expect(r.data.most_frequent).toMatchObject({ name: "D8 Food", transaction_count: 6 });
    expect(r.data.largest_outflow).toMatchObject({
      payee_name: "Transfer : D8 Car Loan",
      amount: 250000,
    });
    const may = await sb(bid, `start_month=2026-05-01&end_month=2026-11-01&${TODAY}`);
    expect([may.data.average_monthly, may.data.average_daily]).toEqual([135820, 4440]);
    const groups = await sb(bid, `${JUN_NOV}&group_by=group`);
    expect(groups.data.items.map((i: Json) => [i.name, i.total, i.share_pct])).toEqual([
      ["D8 Group", 935740, 98],
      ["Uncategorized", 15000, 2],
    ]);
    expect(groups.data.most_frequent.transaction_count).toBe(12);
    const drill = await sb(bid, `${JUN_NOV}&group_id=${g.id}`);
    expect([drill.data.total, drill.data.average_monthly, drill.data.average_daily]).toEqual([
      935740, 155960, 5110,
    ]);
    expect(drill.data.group).toEqual({ id: g.id, name: "D8 Group" });
    expect(drill.data.items.slice(0, 2).map((i: Json) => i.share_pct)).toEqual([52, 27]);
    const noUnc = await sb(bid, `${JUN_NOV}&excluded_category_ids=uncategorized`);
    expect(noUnc.data.total).toBe(935740);
    const none = await sb(bid, `${JUN_NOV}&excluded_account_ids=${chk}`);
    expect(none.data).toMatchObject({
      total: 0,
      items: [],
      most_frequent: null,
      largest_outflow: null,
    });
    const month = await sb(bid, TODAY);
    expect([month.data.total, month.data.average_monthly, month.data.average_daily]).toEqual([
      55000, 55000, 1830,
    ]);
  });

  it("answers 422 and 404", async () => {
    const { bid } = await example();
    const get = (q: string) => json(`${base(bid)}/reports/spending-breakdown?${q}`);
    expect((await get("start_month=2026-06-01")).status).toBe(422);
    expect((await get("start_month=2026-07-01&end_month=2026-06-01")).status).toBe(422);
    expect((await get(`${JUN_NOV}&group_id=nope`)).status).toBe(404);
    expect((await get(`${JUN_NOV}&group_by=week`)).status).toBe(422);
  });

  it("MCP returns the REST object", async () => {
    const { bid } = await example();
    const rest = (await sb(bid, JUN_NOV)).data;
    const body = await mcp("get_spending_breakdown", {
      budget_id: bid,
      start_month: "2026-06-01",
      end_month: "2026-11-01",
    });
    expect(body.result.structuredContent).toEqual(rest);
    const bad = await mcp("get_spending_breakdown", {
      budget_id: bid,
      start_month: "2026-07-01",
      end_month: "2026-06-01",
    });
    expect(bad.result.isError).toBe(true);
  });
});

describe("reports/transactions", () => {
  it("lists a category newest first, with refunds and memos", async () => {
    const { bid, g, chk, loan } = await example();
    const rows = await txs(
      bid,
      `start_month=2026-06-01&end_month=2026-11-01&category_id=${g.ids["D8 Food"]}`,
    );
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ["2026-11-03", -55000],
      ["2026-10-21", 20000],
      ["2026-10-09", -150000],
      ["2026-09-12", -99990],
      ["2026-08-05", -80500],
      ["2026-07-10", -120000],
    ]);
    expect(rows[1]).toMatchObject({ memo: "refund", account_name: "D8 Checking", account_id: chk });
    expect(rows[5].memo).toBe("weekly shop");
    const unc = await txs(bid, "start_month=2026-06-01&end_month=2026-11-01&uncategorized=true");
    expect(unc.map((r) => [r.payee_name, r.amount])).toEqual([["D8 Mystery", -15000]]);
    const grp = await txs(bid, `start_month=2026-06-01&end_month=2026-11-01&group_id=${g.id}`);
    expect(grp).toHaveLength(12);
    expect(grp.find((r) => r.amount === -250000).payee_name).toBe("Transfer : D8 Car Loan");
    const none = await txs(
      bid,
      `start_month=2026-06-01&end_month=2026-11-01&uncategorized=true&excluded_account_ids=${chk}`,
    );
    expect(none).toEqual([]);
    expect(loan).toBeTruthy();
  });

  it("422 for the selectors and 404 for another plan's category", async () => {
    const { bid, g } = await example();
    const other = await example();
    const q = "start_month=2026-06-01&end_month=2026-11-01";
    const get = (s: string) => json(`${base(bid)}/reports/transactions?${q}${s}`);
    expect((await get("")).status).toBe(422);
    expect((await get(`&category_id=${g.ids["D8 Food"]}&uncategorized=true`)).status).toBe(422);
    expect((await get(`&category_id=${other.g.ids["D8 Food"]}`)).status).toBe(404);
    expect((await get(`&group_id=${other.g.id}`)).status).toBe(404);
    const bad = await mcp("list_report_transactions", {
      budget_id: bid,
      start_month: "2026-06-01",
      end_month: "2026-11-01",
    });
    expect(bad.result.isError).toBe(true);
  });
});

describe("the split case and transfers between on-plan accounts", () => {
  const MONTH = "start_month=2026-11-01&end_month=2026-11-01";
  it("counts each line once and the on-plan transfer nowhere", async () => {
    const { bid, g } = await splitPlan();
    const r = (await sb(bid, `${MONTH}&${TODAY}`)).data;
    expect(r.total).toBe(200000);
    expect(r.items.map((i: Json) => [i.name, i.total, i.share_pct])).toEqual([
      ["S Food", 95000, 48],
      ["Uncategorized", 65000, 33],
      ["S Fun", 40000, 20],
    ]);
    expect(r.most_frequent).toMatchObject({ name: "S Food", transaction_count: 3 });
    expect(r.largest_outflow).toMatchObject({ payee_name: "S Market", amount: 60000 });
    const food = await txs(bid, `${MONTH}&category_id=${g.ids["S Food"]}`);
    expect(food.map((t) => [t.amount, t.payee_name, t.memo])).toEqual([
      [-15000, "S Shop", null],
      [-20000, "S Shop", "line memo"],
      [-60000, "S Market", null],
    ]);
    const unc = await txs(bid, `${MONTH}&uncategorized=true`);
    expect(unc.map((t) => [t.payee_name, t.amount])).toEqual([
      ["Transfer : S Loan", -55000],
      ["S Line Payee", -10000],
    ]);
    const via = await mcp("get_spending_breakdown", {
      budget_id: bid,
      start_month: "2026-11-01",
      end_month: "2026-11-01",
    });
    expect(via.result.structuredContent.total).toBe(200000);
    const list = await mcp("list_report_transactions", {
      budget_id: bid,
      start_month: "2026-11-01",
      end_month: "2026-11-01",
      uncategorized: true,
    });
    expect(list.result.structuredContent.transactions).toEqual(unc);
    // Neither the -200000 transfer nor the -100000 parent is anywhere.
    for (const t of [...food, ...unc]) {
      expect([-200000, -100000, -30000]).not.toContain(t.amount);
      expect(t.payee_name).not.toBe("Transfer : S Savings");
    }
  });

  it("exports the ZIP with both CSVs", async () => {
    const { bid } = await splitPlan();
    const res = await json(`${base(bid)}/reports/spending-breakdown/export?${MONTH}&${TODAY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="budget-reflect-spending-breakdown-2026-11-15.zip"',
    );
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual([
      "budget-reflect-spending-breakdown-2026-11-15.csv",
      "budget-reflect-spending-breakdown-2026-11-15-transactions.csv",
    ]);
    const [summary, trans] = [...files.values()].map((b) =>
      new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(b),
    );
    for (const t of [summary as string, trans as string]) {
      expect(t.startsWith("﻿")).toBe(true);
      expect(t).not.toContain("\r");
      expect(t.endsWith("\n")).toBe(false);
    }
    expect(summary).toContain('"S Group","S Food",-95.00,-95.00,-95.00');
    expect((trans as string).split("\n")).toHaveLength(7);
    expect(trans).not.toContain("100.00");
    expect(trans).not.toContain("S Savings");
  });

  it("exports the example's rows", async () => {
    const { bid } = await example();
    const res = await json(`${base(bid)}/reports/spending-breakdown/export?${JUN_NOV}`);
    const files = [...unzip(new Uint8Array(await res.arrayBuffer())).values()].map((b) =>
      new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(b),
    );
    const summary = (files[0] as string).split("\n");
    expect(summary).toContain(
      '"D8 Group","D8 Food",0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-80.92,-485.49',
    );
    expect(summary.at(-1)).toBe('"","Uncategorized",0.00,0.00,0.00,-15.00,0.00,0.00,-2.50,-15.00');
    const trans = files[1] as string;
    expect(trans).toContain(
      '"D8 Checking","","10/01/2026","Transfer : D8 Car Loan","D8 Group: D8 Loan Pmt","D8 Group","D8 Loan Pmt","",$250.00,$0.00,"Uncleared"',
    );
    expect(trans).toContain('"Hidden Categories: D8 Hidden","Hidden Categories","D8 Hidden"');
    expect(trans).not.toContain("D8 Savings");
    expect(trans.split("\n")).toHaveLength(14);
  });
});
