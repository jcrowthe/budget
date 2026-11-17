import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { authHeaders, testName } from "./auth";

// EXF-509: the plan behind the Activity popover specs. API only; the clock is 2026-11-16.
export const CLOCK = "2026-11-16";
export const NOV = "2026-11-01";

export type ActivitySeed = {
  id: string;
  food: string;
  other: string;
  empty: string;
  checking: string;
};

async function call(
  request: APIRequestContext,
  method: "post" | "patch" | "delete",
  path: string,
  data?: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json().catch(() => ({}))).data;
}

/**
 * The design's acceptance plan: ZZ Checking, ZZ Old (closed at the end), a tracking account, ZZ Group with
 * ZZ Food, ZZ Other and ZZ Empty (no activity). ZZ Food holds, in November 2026: an outflow of -60.00
 * (11/15), a +12.00 refund, a split line of -30.00, a categorized transfer to the tracking account, a row on
 * ZZ Old, and three rows that do not count (deleted, a scheduled one not entered, and 10/31).
 *   rows: n extra outflows in ZZ Food. long: a 120-character payee and memo. only: just the -60.00 row.
 *   everywhere: -1.00 in every other ordinary category, so every row of the grid has an Activity button.
 */
export async function seedActivity(
  request: APIRequestContext,
  opts: { rows?: number; long?: boolean; only?: boolean; everywhere?: boolean } = {},
): Promise<ActivitySeed> {
  const { budget } = await call(request, "post", "/api/v1/budgets", { name: testName("activity") });
  const base = `/api/v1/budgets/${budget.id}`;
  const open = async (name: string, type: string) =>
    (
      await call(request, "post", `${base}/accounts`, {
        name,
        type,
        balance: 0,
        date: "2026-11-02",
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking");
  const old = await open("ZZ Old", "checking");
  const tracking = await open("ZZ Tracking", "otherAsset");
  const group = (await call(request, "post", `${base}/category_groups`, { name: "ZZ Group" }))
    .category_group.id as string;
  const cat = async (name: string) =>
    (await call(request, "post", `${base}/categories`, { group_id: group, name })).category
      .id as string;
  const food = await cat("ZZ Food");
  const other = await cat("ZZ Other");
  const empty = await cat("ZZ Empty");
  const tx = (data: Record<string, unknown>) =>
    call(request, "post", `${base}/transactions`, { approved: true, ...data });
  await tx({
    account_id: checking,
    date: "2026-11-15",
    amount: -60000,
    category_id: food,
    payee_name: "ZZ Market",
  });
  if (!opts.only) {
    await tx({
      account_id: checking,
      date: "2026-11-14",
      amount: 12000,
      category_id: food,
      payee_name: "ZZ Refund Shop",
    });
    await tx({
      account_id: checking,
      date: "2026-11-13",
      amount: -50000,
      payee_name: "ZZ Hardware",
      subtransactions: [
        { amount: -30000, category_id: food },
        { amount: -20000, category_id: other },
      ],
    });
    await tx({
      account_id: checking,
      date: "2026-11-12",
      amount: -25000,
      category_id: food,
      transfer_account_id: tracking,
    });
    await tx({
      account_id: old,
      date: "2026-11-11",
      amount: -7000,
      category_id: food,
      payee_name: "ZZ Kiosk",
    });
    const gone = await tx({
      account_id: checking,
      date: "2026-11-10",
      amount: -9000,
      category_id: food,
    });
    await call(request, "delete", `${base}/transactions/${gone.transaction.id}`);
    await call(request, "post", `${base}/scheduled-transactions?today=${CLOCK}`, {
      account_id: checking,
      date_first: "2026-11-28",
      frequency: "monthly",
      amount: -40000,
      category_id: food,
    });
    await tx({ account_id: checking, date: "2026-10-31", amount: -15000, category_id: food });
    await call(request, "post", `${base}/accounts/${old}/close`);
  }
  if (opts.long) {
    await tx({
      account_id: checking,
      date: "2026-11-09",
      amount: -1000,
      category_id: food,
      payee_name: `ZZ ${"P".repeat(117)}`,
      memo: `ZZ ${"M".repeat(117)}`,
    });
  }
  for (let i = 0; i < (opts.rows ?? 0); i++) {
    await tx({
      account_id: checking,
      date: `2026-11-${String(1 + (i % 8)).padStart(2, "0")}`,
      amount: -(i + 1) * 100,
      category_id: food,
      payee_name: `ZZ Payee ${i + 1}`,
      memo: `ZZ memo ${i + 1}`,
    });
  }
  if (opts.everywhere) {
    const m = await (
      await request.get(`${base}/months/${NOV}?today=${CLOCK}`, { headers: await authHeaders() })
    ).json();
    for (const g of m.data.groups) {
      if (g.kind !== null) continue;
      for (const c of g.categories) {
        if (c.kind !== null || c.activity !== 0) continue;
        if (c.id === empty) continue;
        await tx({
          account_id: checking,
          date: "2026-11-03",
          amount: -1000,
          category_id: c.id,
          payee_name: "ZZ Fill",
        });
      }
    }
  }
  return { id: budget.id, food, other, empty, checking };
}

export const removePlan = (request: APIRequestContext, s: { id: string }) =>
  call(request, "delete", `/api/v1/budgets/${s.id}`);
