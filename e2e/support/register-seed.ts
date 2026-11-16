import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders, testName } from "./auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const MONTH = `${TODAY.slice(0, 7)}-01`;

export async function call(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
) {
  // A busy server (other specs share its D1) may answer 409 or 5xx once: seeding retries those.
  let res = await request.fetch(path, { method, headers: await authHeaders(), data });
  for (
    let attempt = 0;
    attempt < 4 && !res.ok() && (res.status() === 409 || res.status() >= 500);
    attempt++
  ) {
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    res = await request.fetch(path, { method, headers: await authHeaders(), data });
  }
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()).data;
}

/** A plan with ZZ Checking ($2,500.00), ZZ Card ($1,500.00 owed), ZZ Asset (tracking) and D4 Groceries ($200.00). */
export async function seed(request: APIRequestContext, withCategory = true) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("entry") });
  const plan = budget.id as string;
  const open = (name: string, type: string, balance: number) =>
    call(request, "POST", `/api/v1/budgets/${plan}/accounts`, { name, type, balance, date: TODAY });
  const checking = (await open("ZZ Checking", "checking", 2500000)).account.id as string;
  const card = (await open("ZZ Card", "creditCard", 1500000)).account.id as string;
  const asset = (await open("ZZ Asset", "otherAsset", 5000000)).account.id as string;
  let category = "";
  if (withCategory) {
    const g = (
      await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
        name: "D4 Register",
      })
    ).category_group.id;
    category = (
      await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
        group_id: g,
        name: "D4 Groceries",
      })
    ).category.id as string;
    await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${MONTH}/categories/${category}`, {
      assigned: 200000,
    });
  }
  return { plan, checking, card, asset, category };
}

export const txs = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as {
    id: string;
    payee_name: string | null;
    payee_id: string | null;
    amount: number;
    cleared: string;
    approved: boolean;
    category_id: string | null;
    date: string;
    memo: string | null;
  }[];

export const payeeList = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/payees?include_hidden=true`)).payees as {
    id: string;
    name: string;
    hidden: boolean;
    system: string | null;
    last_category_id: string | null;
    last_inflow_to_ready_to_assign: boolean;
  }[];

/**
 * Seed W: ZZ Checking ($530.00), ZZ Savings ($200.00), ZZ Brokerage (tracking, $1,000.00), the group "D4 Fun
 * Group" with D4 Fun, D4 Groceries and D4 Dining, and two uncleared outflows today on Checking: $15.00 D4 Fun
 * and $105.00 D4 Groceries (Checking Uncleared -$120.00, Working $410.00; D4 Fun Activity -$15.00). API only.
 */
export async function seedWorked(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("transfers"),
  });
  const plan = budget.id as string;
  const open = async (name: string, type: string, balance: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance,
        date: TODAY,
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking", 530000);
  const savings = await open("ZZ Savings", "savings", 200000);
  const brokerage = await open("ZZ Brokerage", "otherAsset", 1000000);
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "D4 Fun Group" })
  ).category_group.id as string;
  const category = async (name: string) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/categories`, { group_id: group, name }))
      .category.id as string;
  const fun = await category("D4 Fun");
  const groceries = await category("D4 Groceries");
  const dining = await category("D4 Dining");
  const spend = (amount: number, category_id: string) =>
    call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
      account_id: checking,
      date: TODAY,
      amount,
      category_id,
    });
  await spend(-15000, fun);
  await spend(-105000, groceries);
  return { plan, checking, savings, brokerage, fun, groceries, dining, month: MONTH };
}

/** The month as the Plan reads it: every category's activity, `uncategorized` and Ready to Assign. */
export async function planMonth(request: APIRequestContext, plan: string, month: string) {
  const m = await call(request, "GET", `/api/v1/budgets/${plan}/months/${month}`);
  const cats = m.groups.flatMap((g: { categories: unknown[] }) => g.categories) as {
    id: string;
    name: string;
    activity: number;
  }[];
  return {
    rta: m.ready_to_assign as number,
    uncategorized: (m.uncategorized?.activity ?? 0) as number,
    activity: Object.fromEntries(cats.map((c) => [c.id, c.activity])) as Record<string, number>,
  };
}

export const accountData = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`)) as {
    balances: { cleared: number; uncleared: number; working: number };
    transactions: {
      id: string;
      account_id: string;
      amount: number;
      date: string;
      memo: string | null;
      cleared: string;
      category_id: string | null;
      payee_name: string | null;
      transfer_account_id: string | null;
      transfer_transaction_id: string | null;
      subtransactions: {
        amount: number;
        category_id: string | null;
        payee_name: string | null;
        memo: string | null;
      }[];
    }[];
  };

/** Clicks with the real mouse at the element's centre, after checking it is the topmost element there. */
export async function realClick(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
) {
  await target.scrollIntoViewIfNeeded();
  // A list that is still loading moves its footer: wait until the box has stopped moving.
  let box = await target.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await target.boundingBox();
    const still =
      !!box &&
      !!next &&
      box.x === next.x &&
      box.y === next.y &&
      box.width === next.width &&
      box.height === next.height;
    box = next;
    if (still) break;
  }
  expect(box, "the control has a box").not.toBeNull();
  const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
  const cx = x + width / 2;
  const cy = y + height / 2;
  const topmost = await target.evaluate(
    (el, [px, py]) => {
      const hit = document.elementFromPoint(px as number, py as number);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    },
    [cx, cy],
  );
  expect(topmost, "the control is topmost at its centre").toBe(true);
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
}
