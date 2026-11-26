import type { APIRequestContext, Page } from "@playwright/test";
import { call } from "./register-seed";

/**
 * EXF-466: the browser's stand-in for the bank's pending transactions. No real pending row can be made (no Plaid, no
 * writes to the database from outside), so the list `GET …/transactions?status=pending` is answered here, in the shape
 * the Worker gives a pending item (`pendingToApi`, `apps/worker/src/services/pending-transactions.ts`: status
 * "pending", pending_transaction_id the bank's id, no category, uncleared, unapproved, source plaid). Enter Now is
 * answered here too, but it makes the REAL row through `POST …/transactions` (account, date, amount, payee, uncleared,
 * approved), so the server's balances really change; the stub removes the item from its list and dresses that row in
 * the list and detail answers with `status: "entered"` and `pending_transaction_id`, as the Worker does. A `PATCH`
 * that only sets `status` on a dressed row is answered here (the real row has no pending id); every other request goes
 * to the real server. Requests are recorded.
 */
type Item = { payee: string; amount: number; date: string };
type Pending = Item & { id: string; plaid: string };
type Row = Record<string, unknown> & { id: string };
export type Posted = { url: string; body: unknown };

export async function stubPending(
  page: Page,
  request: APIRequestContext,
  opts: { budgetId: string; accountId: string; items: Item[] },
) {
  const now = new Date().toISOString();
  const items: Pending[] = opts.items.map((i) => ({
    ...i,
    id: crypto.randomUUID(),
    plaid: `zz-pend-${crypto.randomUUID().slice(0, 8)}`,
  }));
  const entered = new Map<string, { plaid: string; status: "entered" | null }>();
  const requests: Posted[] = [];
  const enterPosts: Posted[] = [];
  const clockPatches: Posted[] = [];
  const base = `/api/v1/budgets/${opts.budgetId}`;

  const dress = (r: Row): Row => {
    const e = entered.get(r.id);
    return e ? { ...r, status: e.status, pending_transaction_id: e.plaid } : r;
  };
  const asPending = (p: Pending) => ({
    id: p.id,
    budget_id: opts.budgetId,
    account_id: opts.accountId,
    account_name: "ZZ-TEST Pending Checking",
    date: p.date,
    payee_id: null,
    payee_name: p.payee,
    category_id: null,
    inflow_to_ready_to_assign: false,
    memo: null,
    amount: p.amount,
    cleared: "uncleared",
    approved: false,
    created_at: now,
    import_id: null,
    source: "plaid",
    imported_payee: p.payee,
    import_payee_name: p.payee,
    bank_description: p.payee,
    matched: false,
    flag_color: null,
    status: "pending",
    pending_transaction_id: p.plaid,
    category_name: null,
    category_group_name: null,
    payee_system: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    transfer_account_name: null,
    subtransactions: [],
    updated_at: now,
    match_details: null,
  });
  const record = (url: string, body: unknown) => requests.push({ url, body });

  // The pending list of the account: the server's own balances, which pending changes nothing in.
  await page.route(/\/transactions\?(?:[^#]*&)?status=pending/, async (route) => {
    record(route.request().url(), null);
    const real = await call(request, "GET", `${base}/accounts/${opts.accountId}/transactions`);
    await route.fulfill({
      json: { data: { transactions: items.map(asPending), balances: real.balances } },
    });
  });

  // The account's list: the entered rows wear their clock.
  await page.route(/\/accounts\/[^/]+\/transactions(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const list = body?.data?.transactions as Row[] | undefined;
    if (Array.isArray(list)) body.data.transactions = list.map(dress);
    await route.fulfill({ response: res, json: body });
  });

  await page.route(/\/transactions\/[^/?]+\/enter-now$/, async (route) => {
    const id = route.request().url().split("/").slice(-2)[0] as string;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    enterPosts.push({ url: route.request().url(), body });
    record(route.request().url(), body);
    const item = items.find((i) => i.id === id);
    if (!item)
      return route.fulfill({
        status: 404,
        json: { error: { id: "404", name: "not_found", detail: "Pending transaction not found" } },
      });
    const created = await call(request, "POST", `${base}/transactions`, {
      account_id: opts.accountId,
      date: (body.date as string | undefined) ?? item.date,
      amount: (body.amount as number | undefined) ?? item.amount,
      payee_name: (body.payee_name as string | undefined) ?? item.payee,
      ...(body.memo !== undefined ? { memo: body.memo } : {}),
      cleared: "uncleared",
      approved: true,
    });
    const tx = created.transaction as Row;
    items.splice(items.indexOf(item), 1);
    entered.set(tx.id, { plaid: item.plaid, status: "entered" });
    await route.fulfill({ json: { data: { transaction: dress(tx) } } });
  });

  // The clock: a PATCH of status alone on an entered row.
  await page.route(/\/transactions\/[^/?]+$/, async (route) => {
    const req = route.request();
    const id = req.url().split("/").pop()?.split("?")[0] as string;
    const known = entered.get(id);
    if (!known) return route.continue();
    if (req.method() === "GET") {
      const res = await route.fetch();
      const body = await res.json();
      if (body?.data?.transaction) body.data.transaction = dress(body.data.transaction);
      return route.fulfill({ response: res, json: body });
    }
    const patch = req.postDataJSON() as Record<string, unknown> | null;
    if (req.method() !== "PATCH" || !patch || Object.keys(patch).join() !== "status") {
      return route.continue();
    }
    clockPatches.push({ url: req.url(), body: patch });
    record(req.url(), patch);
    known.status = (patch.status as "entered" | null) ?? null;
    const real = await call(request, "GET", `${base}/transactions/${id}`);
    await route.fulfill({ json: { data: { transaction: dress(real.transaction) } } });
  });

  return {
    items,
    requests,
    enterPosts,
    clockPatches,
    pendingGets: () => requests.filter((r) => r.body === null).length,
  };
}
