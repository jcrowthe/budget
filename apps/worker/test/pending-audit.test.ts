import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exportPlan } from "../src/services/plan-export";
import { json } from "./helpers";
import { pend, pendingRows } from "./pending-helpers";
import { plaidTxn } from "./plaid-stub";
import {
  data,
  feed,
  hand,
  type Json,
  linked,
  setupPlaid,
  stubBank,
  syncOne,
  TX,
  world,
} from "./plaid-sync-helpers";
import { NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";

// EXF-466 audit: with pending rows present, every read that sums or lists transactions equals the same plan without
// them. Two plans are built through the same feed; plan A's feed also has pending items in two months, on a checking
// account and on a credit card, outflows and inflows.

pinPlanClock();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const norm = (v: unknown) =>
  (typeof v === "string" ? v : JSON.stringify(v)).replace(UUID, "ID").replace(STAMP, "TS");

const cardAccounts = () => ({
  "/accounts/get": () => ({
    body: {
      item: { institution_id: "ins_109508" },
      accounts: [
        {
          account_id: "acc-chk",
          name: "ZZ Checking",
          mask: "0000",
          type: "depository",
          subtype: "checking",
          balances: { current: 1000, available: null },
        },
        {
          account_id: "acc-card",
          name: "ZZ Card",
          mask: "1111",
          type: "credit",
          subtype: "credit card",
          balances: { current: 100, available: null },
        },
      ],
    },
  }),
});

async function build(withPending: boolean) {
  await setupPlaid();
  stubBank(cardAccounts());
  const w = await world();
  const checking = await linked(w.plan, w.bank["ZZ Checking"] as string);
  const card = await linked(w.plan, w.bank["ZZ Card"] as string);
  const m = await data(await json(`/api/v1/budgets/${w.plan}/months/2026-03-01`));
  const cats = m.groups
    .filter((g: Json) => !/credit card/i.test(g.name))
    .flatMap((g: Json) => g.categories) as Json[];
  const [c1, c2] = cats as [Json, Json];
  for (const [account, date, amount, cat] of [
    [checking, "2026-03-11", -20000, c1],
    [card, "2026-04-05", -30000, c2],
  ] as const) {
    const r = await hand(w.plan, { account_id: account, date, amount, category_id: cat.id });
    expect(r.status).toBe(201);
  }
  const posted = [
    plaidTxn({ transaction_id: "ZZ-OUT", amount: 12.34, date: "2026-03-12", name: "ZZ Out" }),
    plaidTxn({ transaction_id: "ZZ-IN", amount: -50, date: "2026-03-14", name: "ZZ In" }),
    plaidTxn({
      transaction_id: "ZZ-CARD",
      account_id: "acc-card",
      amount: 25,
      date: "2026-04-06",
      name: "ZZ Card Shop",
    }),
  ];
  const pending = withPending
    ? [
        pend("ZZ-PC1", { amount: 7.5, date: "2026-03-15" }),
        pend("ZZ-PC2", { amount: -100, date: "2026-03-16" }),
        pend("ZZ-PK1", { account_id: "acc-card", amount: 40, date: "2026-04-10" }),
        pend("ZZ-PK2", { account_id: "acc-card", amount: -15, date: "2026-04-11" }),
      ]
    : [];
  feed.pages = [{ added: [...posted, ...pending] }] as typeof feed.pages;
  await syncOne(w.plan, w.conn);
  return { ...w, checking, card, cats };
}

const get = async (path: string) => {
  const res = await json(path);
  expect(res.status, path).toBe(200);
  return res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
};

async function reads(w: Awaited<ReturnType<typeof build>>) {
  const base = `/api/v1/budgets/${w.plan}`;
  const span = "start_month=2026-03-01&end_month=2026-04-01&today=2026-04-30";
  const out: Record<string, unknown> = {};
  for (const month of ["2026-03-01", "2026-04-01"]) {
    out[`month ${month}`] = await get(`${base}/months/${month}`);
    for (const [i, c] of w.cats.slice(0, 2).entries()) {
      out[`activity ${month} ${i}`] = await get(
        `${base}/months/${month}/categories/${c.id}/transactions`,
      );
    }
  }
  out.accounts = await get(`${base}/accounts`);
  out.netWorth = await get(`${base}/reports/net-worth?${span}`);
  out.ageOfMoney = await get(`${base}/reports/age-of-money?today=2026-04-30`);
  out.breakdown = await get(`${base}/reports/spending-breakdown?${span}`);
  out.trends = await get(`${base}/reports/spending-trends?${span}`);
  out.incomeExpense = await get(`${base}/reports/income-expense?${span}`);
  out.planList = await get(`${base}/transactions`);
  out.register = await get(`${base}/accounts/${w.checking}/transactions`);
  out.cardRegister = await get(`${base}/accounts/${w.card}/transactions`);
  out.search = await get(`${base}/transactions?q=zz`);
  const ids = ((out.planList as Json).data.transactions as Json[]).map((t) => t.id);
  out.csv = await get(`${base}/transactions/export?ids=${ids.slice(0, 100).join(",")}`);
  const zip = await exportPlan(env, w.plan, { now: NOW });
  out.zip = readZip(zip.bytes).map((e) => text(e.data));
  return out;
}

describe("pending rows change no read (EXF-466 audit)", () => {
  it("the month, accounts, activity, reports, lists, search and exports equal the plan without them", async () => {
    const a = await build(true);
    expect(await pendingRows(a.checking)).toHaveLength(2);
    expect(await pendingRows(a.card)).toHaveLength(2);
    const withPending = await reads(a);
    const planA = a.plan;
    const b = await build(false);
    expect(await pendingRows(b.checking)).toHaveLength(0);
    const without = await reads(b);
    for (const key of Object.keys(without)) {
      const left = norm(withPending[key]).replaceAll(planA, "PLAN");
      const right = norm(without[key]).replaceAll(b.plan, "PLAN");
      expect(left, key).toEqual(right);
    }
    // the lists hold no pending item, and the register and plan lists have the same row counts
    for (const key of ["planList", "register", "cardRegister", "search"]) {
      const rows = (withPending[key] as Json).data.transactions as Json[];
      expect(
        rows.some((t) => t.status === "pending"),
        key,
      ).toBe(false);
      expect(rows.length, key).toBe(((without[key] as Json).data.transactions as Json[]).length);
    }
    // the pending items are listed only on request
    const listed = await data(await json(`${TX(planA)}?status=pending`));
    expect(listed.transactions).toHaveLength(4);
    // and a pending id is not a transaction to export
    const [one] = listed.transactions as Json[];
    expect((await json(`${TX(planA)}/export?ids=${one.id}`)).status).toBe(404);
  }, 120_000);
});
