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
export type PlaidHandler = (body: Record<string, unknown>) => { status?: number; body: unknown };

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
    const r = h(body);
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
