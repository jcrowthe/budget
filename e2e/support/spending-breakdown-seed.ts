import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { authHeaders } from "./auth";
import { mouseClick } from "./menu";
import { addAccount, dateButton, newPlan } from "./reflect";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies
type Json = any;

async function call(
  request: APIRequestContext,
  method: "post" | "patch",
  url: string,
  data: unknown,
) {
  const res = await request[method](url, { headers: await authHeaders(), data });
  expect(res.status(), `${method} ${url}`).toBeLessThan(300);
  return ((await res.json()) as Json).data as Json;
}

async function group(request: APIRequestContext, bid: string, name: string, cats: string[]) {
  const g = (await call(request, "post", `/api/v1/budgets/${bid}/category_groups`, { name }))
    .category_group;
  const ids: Record<string, string> = {};
  // A new category goes first in its group: create them last to first so the listed order is the plan order.
  for (const c of [...cats].reverse()) {
    ids[c] = (
      await call(request, "post", `/api/v1/budgets/${bid}/categories`, { group_id: g.id, name: c })
    ).category.id;
  }
  return { id: g.id as string, ids };
}

export interface SeededPlan {
  plan: { id: string; name: string };
  ids: Record<string, string>;
  groupId: string;
}

/** The EXF-549 example (today 2026-11-15): D8 Checking, D8 Savings, D8 Car Loan (tracking liability). */
export async function seedSpendingExample(
  request: APIRequestContext,
  o: { order?: string[]; earlyMonth?: string } = {},
): Promise<SeededPlan> {
  const plan = await newPlan(request, "spending");
  const bid = plan.id;
  const g = await group(
    request,
    bid,
    "D8 Group",
    o.order ?? ["D8 Food", "D8 Fun", "D8 Utilities", "D8 Loan Pmt", "D8 Hidden"],
  );
  // An on-plan cash account with a Starting Balance on `earlyMonth` (a date) moves the plan's first month back.
  if (o.earlyMonth) await addAccount(request, bid, "D8 Wallet", "cash", 10000, o.earlyMonth);
  const sav = await addAccount(request, bid, "D8 Savings", "savings", 500000, "2026-05-15");
  const chk = await addAccount(request, bid, "D8 Checking", "checking", 2000000, "2026-06-01");
  const loan = await addAccount(
    request,
    bid,
    "D8 Car Loan",
    "otherLiability",
    5000000,
    "2026-06-01",
  );
  const tx = (data: Record<string, unknown>) =>
    call(request, "post", `/api/v1/budgets/${bid}/transactions`, { account_id: chk, ...data });
  const spend = (
    date: string,
    payee: string,
    cat: string | null,
    amount: number,
    extra: Record<string, unknown> = {},
  ) =>
    tx({
      date,
      amount,
      payee_name: payee,
      ...(cat ? { category_id: g.ids[cat] } : {}),
      ...extra,
    });
  const income = (date: string) =>
    tx({
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
  await tx({ date: "2026-09-01", amount: -200000, transfer_account_id: sav });
  await spend("2026-09-03", "D8 Power Co", "D8 Utilities", -60250);
  await spend("2026-09-12", "D8 Grocer", "D8 Food", -99990);
  await income("2026-09-15");
  await spend("2026-09-20", "D8 Mystery", null, -15000);
  await tx({
    date: "2026-10-01",
    amount: -250000,
    transfer_account_id: loan,
    category_id: g.ids["D8 Loan Pmt"],
  });
  await spend("2026-10-07", "D8 Cinema", "D8 Fun", -30000);
  await spend("2026-10-09", "D8 Grocer", "D8 Food", -150000);
  await income("2026-10-15");
  await spend("2026-10-21", "D8 Grocer", "D8 Food", 20000, { memo: "refund" });
  await spend("2026-10-25", "D8 Gift Shop", "D8 Hidden", -40000);
  await spend("2026-11-03", "D8 Grocer", "D8 Food", -55000);
  await call(request, "patch", `/api/v1/budgets/${bid}/categories/${g.ids["D8 Hidden"]}`, {
    hidden: true,
  });
  return { plan, ids: { ...g.ids, chk, sav, loan }, groupId: g.id };
}

/** Plan S: the split case, November 2026 (Lead's note 1). */
export async function seedSplitPlan(request: APIRequestContext): Promise<SeededPlan> {
  const plan = await newPlan(request, "split");
  const bid = plan.id;
  const g = await group(request, bid, "S Group", ["S Food", "S Fun"]);
  const chk = await addAccount(request, bid, "S Checking", "checking", 1000000, "2026-10-01");
  const sav = await addAccount(request, bid, "S Savings", "savings", 100000, "2026-10-01");
  const loan = await addAccount(request, bid, "S Loan", "otherLiability", 500000, "2026-10-01");
  const tx = (data: Record<string, unknown>) =>
    call(request, "post", `/api/v1/budgets/${bid}/transactions`, { account_id: chk, ...data });
  await tx({
    date: "2026-11-04",
    amount: -100000,
    payee_name: "S Market",
    subtransactions: [
      { amount: -60000, category_id: g.ids["S Food"] },
      { amount: -40000, category_id: g.ids["S Fun"] },
    ],
  });
  await tx({
    date: "2026-11-06",
    amount: -30000,
    payee_name: "S Shop",
    subtransactions: [
      { amount: -20000, category_id: g.ids["S Food"], memo: "line memo" },
      { amount: -10000, payee_name: "S Line Payee" },
    ],
  });
  await tx({ date: "2026-11-07", amount: -200000, transfer_account_id: sav });
  await tx({
    date: "2026-11-08",
    amount: -15000,
    payee_name: "S Shop",
    category_id: g.ids["S Food"],
  });
  await tx({ date: "2026-11-09", amount: -55000, transfer_account_id: loan });
  return { plan, ids: { ...g.ids, chk, sav, loan }, groupId: g.id };
}

/** Viewport coordinates of a point inside a donut slice (its data-px/py, checked with elementFromPoint). */
export async function donutPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const slice = page.locator(`.sb-slice[data-id="${id}"]`);
  await expect(slice).toHaveCount(1);
  const p = await slice.evaluate((el) => {
    const svg = el.ownerSVGElement as SVGSVGElement;
    // A narrow window shows only part of the donut: bring it into view before aiming.
    svg.scrollIntoView({ block: "center" });
    const r = svg.getBoundingClientRect();
    const x = r.left + Number(el.getAttribute("data-px"));
    const y = r.top + Number(el.getAttribute("data-py"));
    return { x, y, hit: document.elementFromPoint(x, y) === el };
  });
  expect(p.hit, "the slice is the element at its aim point").toBe(true);
  return { x: p.x, y: p.y };
}

/** Moves the real mouse into a slice. */
export async function hoverSlice(page: Page, id: string) {
  const { x, y } = await donutPoint(page, id);
  await page.mouse.move(x, y);
}

/** Clicks a slice with the real mouse. */
export async function clickSlice(page: Page, id: string) {
  const { x, y } = await donutPoint(page, id);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

/** The plan order of the Income v Expense worked table. */
export const IE_ORDER = ["D8 Hidden", "D8 Loan Pmt", "D8 Utilities", "D8 Fun", "D8 Food"];

/** Plan T: a split with lines in two groups, and a net inflow with no category (November 2026). */
export async function seedTrendsSplitPlan(request: APIRequestContext): Promise<SeededPlan> {
  const plan = await newPlan(request, "trends-split");
  const bid = plan.id;
  const needs = await group(request, bid, "T Needs", ["T Food"]);
  const wants = await group(request, bid, "T Wants", ["T Fun"]);
  const chk = await addAccount(request, bid, "T Checking", "checking", 1000000, "2026-10-01");
  const tx = (data: Record<string, unknown>) =>
    call(request, "post", `/api/v1/budgets/${bid}/transactions`, { account_id: chk, ...data });
  await tx({
    date: "2026-11-04",
    amount: -100000,
    payee_name: "T Market",
    subtransactions: [
      { amount: -60000, category_id: needs.ids["T Food"] },
      { amount: -40000, category_id: wants.ids["T Fun"] },
    ],
  });
  await tx({ date: "2026-11-06", amount: 50000, payee_name: "T Refund" });
  return { plan, ids: { ...needs.ids, ...wants.ids, chk }, groupId: needs.id };
}

/** Plan I: income by payee (a split's lines, a transfer, no payee) and a negative balance adjustment. */
export async function seedIncomePlan(request: APIRequestContext): Promise<SeededPlan> {
  const plan = await newPlan(request, "income");
  const bid = plan.id;
  const chk = await addAccount(request, bid, "I Checking", "checking", 1000000, "2026-10-01");
  const loan = await addAccount(request, bid, "I Loan", "otherLiability", 500000, "2026-10-01");
  const tx = (data: Record<string, unknown>) =>
    call(request, "post", `/api/v1/budgets/${bid}/transactions`, { account_id: chk, ...data });
  await tx({
    date: "2026-11-02",
    amount: 80000,
    payee_name: "I Parent",
    subtransactions: [
      { amount: 50000, inflow_to_ready_to_assign: true },
      { amount: 30000, payee_name: "I Line Payer", inflow_to_ready_to_assign: true },
    ],
  });
  await tx({
    date: "2026-11-03",
    amount: 100000,
    transfer_account_id: loan,
    inflow_to_ready_to_assign: true,
  });
  await tx({ date: "2026-11-05", amount: 10000, inflow_to_ready_to_assign: true });
  await call(request, "post", `/api/v1/budgets/${bid}/accounts/${chk}/adjust-balance`, {
    balance: 1000000 + 80000 + 100000 + 10000 - 250000,
    today: "2026-11-15",
  });
  return { plan, ids: { chk, loan }, groupId: "" };
}

/** Plan E: only a Starting Balance that is then adjusted down to 50.00. */
export async function seedIncomeEmptyPlan(request: APIRequestContext): Promise<SeededPlan> {
  const plan = await newPlan(request, "income-empty");
  const bid = plan.id;
  const chk = await addAccount(request, bid, "E Checking", "checking", 100000, "2026-11-01");
  await call(request, "post", `/api/v1/budgets/${bid}/accounts/${chk}/adjust-balance`, {
    balance: 50000,
    today: "2026-11-15",
  });
  return { plan, ids: { chk }, groupId: "" };
}

/** Custom range through the date menu with the real mouse; the end stays on the current month. */
export async function customFrom(page: Page, from: string, start: string) {
  await mouseClick(page, dateButton(page, from));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "Custom", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: start, exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
}

/** A point inside a chart segment (month `YYYY-MM-01`, series id), checked with elementFromPoint. */
export async function segmentPoint(
  page: Page,
  month: string,
  series: string,
): Promise<{ x: number; y: number }> {
  const seg = page.locator(`.st-seg[data-month="${month}"][data-series="${series}"]`);
  await expect(seg).toHaveCount(1);
  const p = await seg.evaluate((el) => {
    el.ownerSVGElement?.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    // Near the bar's left edge: the month marker's hover circle covers the middle of a short top segment.
    const x = r.left + r.width * 0.15;
    const y = r.top + r.height / 2;
    return { x, y, hit: document.elementFromPoint(x, y) === el };
  });
  expect(p.hit, "the segment is the element at its aim point").toBe(true);
  return { x: p.x, y: p.y };
}

/** Sets a stored range for a report through the API (the date menu itself is covered elsewhere). */
export async function setRange(
  request: APIRequestContext,
  bid: string,
  report: string,
  start: string,
  end: string,
) {
  const res = await request.put(`/api/v1/budgets/${bid}/report-settings/${report}`, {
    headers: await authHeaders(),
    data: { preset: "custom", start_month: start, end_month: end },
  });
  expect(res.status()).toBe(200);
}
