import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { authHeaders } from "./auth";
import { addAccount, newPlan } from "./reflect";

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
export async function seedSpendingExample(request: APIRequestContext): Promise<SeededPlan> {
  const plan = await newPlan(request, "spending");
  const bid = plan.id;
  const g = await group(request, bid, "D8 Group", [
    "D8 Food",
    "D8 Fun",
    "D8 Utilities",
    "D8 Loan Pmt",
    "D8 Hidden",
  ]);
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
