import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { authHeaders, testName } from "./auth";

export const NOW = new Date("2026-11-15T12:00:00");

export async function newPlan(request: APIRequestContext, label = "reflect") {
  const name = testName(label);
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  return { id: (await res.json()).data.budget.id as string, name };
}

export async function addAccount(
  request: APIRequestContext,
  bid: string,
  name: string,
  type: string,
  balance: number,
  date: string,
): Promise<string> {
  const res = await request.post(`/api/v1/budgets/${bid}/accounts`, {
    headers: await authHeaders(),
    data: { name, type, balance, date },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.account.id;
}

export async function addTx(
  request: APIRequestContext,
  bid: string,
  account_id: string,
  date: string,
  amount: number,
) {
  const res = await request.post(`/api/v1/budgets/${bid}/transactions`, {
    headers: await authHeaders(),
    data: { account_id, date, amount },
  });
  expect(res.status()).toBe(201);
}

/** The EXF-551 example data; names are "D8 …". */
export async function seedExample(request: APIRequestContext, bid: string) {
  const sav = await addAccount(request, bid, "D8 Savings", "savings", 500000, "2026-05-15");
  await addTx(request, bid, sav, "2026-09-01", 200000);
  const chk = await addAccount(request, bid, "D8 Checking", "checking", 2000000, "2026-06-01");
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
  for (const [d, a] of rows) await addTx(request, bid, chk, d, a);
  const house = await addAccount(request, bid, "D8 House", "otherAsset", 10000000, "2026-06-01");
  await addTx(request, bid, house, "2026-10-31", 500000);
  const loan = await addAccount(
    request,
    bid,
    "D8 Car Loan",
    "otherLiability",
    5000000,
    "2026-06-01",
  );
  await addTx(request, bid, loan, "2026-10-01", 250000);
  return { sav, chk, house, loan };
}

/** Sets the browser clock to 2026-11-15 and opens a report. */
export async function openReport(page: Page, bid: string, slug: string) {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/${bid}/reflect/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The filter bar appears once the settings and the range facts have loaded.
  await expect(page.getByRole("button", { name: "Previous Period", exact: true })).toBeVisible();
}

export const dateButton = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true });
