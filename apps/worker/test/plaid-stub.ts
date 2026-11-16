import { afterEach, vi } from "vitest";
import { json } from "./helpers";

/** Fake credentials: never a real value. Tests assert their absence with `.includes(...)`. */
export const SENTINEL = {
  clientId: "PLAID-CLIENT-SENTINEL-1",
  secret: "PLAID-SECRET-SENTINEL-2",
  accessToken: "PLAID-ACCESS-SENTINEL-3",
  publicToken: "PLAID-PUBLIC-SENTINEL-4",
  linkToken: "PLAID-LINK-SENTINEL-5",
} as const;
export const ALL_SENTINELS = Object.values(SENTINEL);

export interface PlaidCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
type PlaidAnswer = { status?: number; body: unknown };
export type PlaidHandler = (body: Record<string, unknown>) => PlaidAnswer | Promise<PlaidAnswer>;

const realFetch = globalThis.fetch;

/** Serves only Plaid hosts, records each call, and fails on any other URL. Restored after each test. */
export function stubPlaid(handlers: Record<string, PlaidHandler>) {
  const calls: PlaidCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url);
    if (u.hostname !== "sandbox.plaid.com" && u.hostname !== "production.plaid.com") {
      throw new Error(`unexpected fetch to ${u.hostname}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const h = handlers[u.pathname];
    if (!h) return new Response(JSON.stringify({ error_code: "NOT_STUBBED" }), { status: 404 });
    const r = await h(body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

export async function seedSandboxCredentials() {
  const res = await json(
    "/api/v1/plaid/credentials",
    { method: "PUT" },
    { environment: "sandbox", client_id: SENTINEL.clientId, secret: SENTINEL.secret },
  );
  if (res.status !== 200) throw new Error(`seeding credentials failed: ${res.status}`);
}

export async function createPlan(bank_environment?: "sandbox" | "production") {
  const res = await json(
    "/api/v1/budgets",
    { method: "POST" },
    { name: `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`, bank_environment },
  );
  return ((await res.json()) as { data: { budget: { id: string } } }).data.budget.id;
}

/** A made-up posted Plaid transaction (Plaid's sign: positive is money leaving the account). */
export function plaidTxn(over: Record<string, unknown> = {}) {
  const n = crypto.randomUUID().slice(0, 8);
  return {
    transaction_id: `ZZ-TXN-${n}`,
    account_id: "acc-chk",
    amount: 12.34,
    date: "2026-03-12",
    name: `ZZ Shop ${n}`,
    merchant_name: null as string | null,
    original_description: null as string | null,
    pending: false,
    ...over,
  };
}

type Txn = ReturnType<typeof plaidTxn>;
export interface FeedPage {
  added?: Txn[];
  modified?: Txn[];
  removed?: string[];
}

/**
 * A `/transactions/sync` handler: page n is served for the cursor `c<n-1>` (no cursor: page 1) and names
 * `c<n>` as its next cursor; has_more holds until the last page. `pages` may be a function, read per call.
 */
export function syncPages(pages: FeedPage[] | (() => FeedPage[])): PlaidHandler {
  return (body) => {
    const list = typeof pages === "function" ? pages() : pages;
    const cursor = typeof body.cursor === "string" && body.cursor !== "" ? body.cursor : "c0";
    const n = Number(cursor.slice(1)) + 1;
    const page = list[n - 1];
    if (!page && n - 1 === list.length) {
      // The end of the feed: nothing new, the same cursor.
      return {
        body: { added: [], modified: [], removed: [], next_cursor: cursor, has_more: false },
      };
    }
    if (!page) return plaidError(400, "INVALID_FIELD");
    return {
      body: {
        added: page.added ?? [],
        modified: page.modified ?? [],
        removed: (page.removed ?? []).map((transaction_id) => ({ transaction_id })),
        next_cursor: `c${n}`,
        has_more: n < list.length,
      },
    };
  };
}

export function plaidError(status: number, error_code: string) {
  return { status, body: { error_code, error_type: "ITEM_ERROR", display_message: null } };
}
