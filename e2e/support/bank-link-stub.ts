import type { APIRequestContext, Page, Route } from "@playwright/test";
import { authHeaders } from "./auth";
import { fakeInstitution, type RecordedRequest } from "./plaid-stub";

/**
 * Stand-in for the bank half of the app (EXF-461): fake connections and links in memory, answered in the
 * browser. Accounts, Starting Balances and groups are real (the stub makes them through the API); only the
 * link, the connection's status and the unapproved count are laid over the server's own account reads.
 * Nothing here calls Plaid.
 */
export type LinkStatus = "connected" | "delayed" | "login_required" | "broken";
export type PlanType =
  | "checking"
  | "savings"
  | "creditCard"
  | "mortgage"
  | "autoLoan"
  | "studentLoan"
  | "personalLoan"
  | "otherAsset";

export type FakeBankAccount = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  /** The plan account type the app proposes (the specs do not import the app's own rule). */
  plan_type: PlanType;
};
export type FakeConnection = {
  id: string;
  display_id: string;
  nickname: string;
  status: LinkStatus;
  last_synced_at: string | null;
  accounts: FakeBankAccount[];
  /** The bank's own name (default: the nickname). */
  institution_name?: string;
  /** When the connection was last reset (default: never). */
  last_reset_at?: string | null;
  /** The bank's logo as base64 (default: none). */
  logo?: string | null;
};
type Refusal = { status: number; name: string; detail: string };
type SyncAnswer = {
  unapproved?: Record<string, number>;
  result?: Partial<Record<string, unknown>>;
  status?: number;
  detail?: string;
  /** The connection sync answers this many ms late (to look at the button while it runs). */
  delayMs?: number;
};

export function fakeBankAccount(
  over: Partial<FakeBankAccount> & { name: string },
): FakeBankAccount {
  return {
    id: crypto.randomUUID(),
    mask: "0000",
    type: "depository",
    subtype: "checking",
    current_balance: 1250500,
    plan_type: "checking",
    ...over,
  };
}
export function fakeConnection(over: Partial<FakeConnection> & { accounts: FakeBankAccount[] }) {
  return {
    id: crypto.randomUUID(),
    display_id: "0a1b2c",
    nickname: "ZZ Bank",
    status: "connected" as LinkStatus,
    last_synced_at: null,
    ...over,
  } satisfies FakeConnection;
}

const syncResult = (connectionId: string, over: Partial<Record<string, unknown>> = {}) => ({
  bank_connection_id: connectionId,
  status: "connected",
  added: 0,
  matched: 0,
  modified: 0,
  removed: 0,
  skipped: 0,
  has_more: false,
  last_synced_at: new Date().toISOString(),
  ...over,
});

export async function stubBankLink(
  page: Page,
  request: APIRequestContext,
  opts: {
    budgetId: string;
    connections: FakeConnection[];
    newConnection?: FakeConnection;
    popular?: boolean;
    links?: Record<string, string>;
    /** What a linked account reports while its bank account is in no listed connection (yet). */
    orphanSyncedAt?: string;
    unapproved?: Record<string, number>;
    afterSync?: SyncAnswer;
    fromBank?: Refusal;
    link?: Refusal;
    /** Manage Bank Connections (EXF-460): refusals of the rename, the removal and the update-mode token. */
    rename?: Refusal;
    remove?: Refusal;
    updateToken?: Refusal;
  },
): Promise<{
  requests: RecordedRequest[];
  links: Map<string, string>;
  connections: FakeConnection[];
}> {
  const requests: RecordedRequest[] = [];
  const connections = [...opts.connections];
  const links = new Map(Object.entries(opts.links ?? {}));
  const unapproved = new Map(Object.entries(opts.unapproved ?? {}));
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const refuse = (route: Route, r: Refusal) =>
    json(route, r.status, { error: { id: String(r.status), name: r.name, detail: r.detail } });
  const record = (route: Route) => {
    const req = route.request();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    requests.push({ method: req.method(), url: req.url(), body });
    return body;
  };
  const bankAccountById = (id: string) =>
    connections.flatMap((c) => c.accounts).find((a) => a.id === id);
  const connectionOfBank = (id: string) =>
    connections.find((c) => c.accounts.some((a) => a.id === id));
  const connectionJson = (c: FakeConnection) => ({
    id: c.id,
    display_id: c.display_id,
    environment: "sandbox",
    institution_id: "ins_test_1",
    institution_name: c.institution_name ?? c.nickname,
    institution_logo: c.logo ?? null,
    nickname: c.nickname,
    status: c.status,
    provider: "Plaid",
    last_synced_at: c.last_synced_at,
    last_reset_at: c.last_reset_at ?? null,
    sync_failed_at: null,
    created_at: "2030-01-01T00:00:00Z",
    accounts: c.accounts.map((a) => ({
      id: a.id,
      bank_connection_id: c.id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current_balance: a.current_balance,
      available_balance: null,
      balance_updated_at: null,
      linked_account_id: [...links].find(([, bank]) => bank === a.id)?.[0] ?? null,
    })),
  });
  const overlay = (a: Record<string, unknown>) => {
    const bank = links.get(a.id as string);
    const conn = bank ? connectionOfBank(bank) : undefined;
    return {
      ...a,
      bank_account_id: bank ?? null,
      linked: !!bank,
      import_start_date: bank ? "2030-01-01" : null,
      connection_status: conn?.status ?? (bank ? "connected" : null),
      last_synced_at: conn ? conn.last_synced_at : bank ? (opts.orphanSyncedAt ?? null) : null,
      unapproved_count: unapproved.get(a.id as string) ?? 0,
    };
  };
  /** After a sync: the connection is synced now and the rows it "brought" count as unapproved. */
  const applySync = (connectionId?: string) => {
    for (const c of connections) {
      if (connectionId && c.id !== connectionId) continue;
      c.last_synced_at = new Date().toISOString();
    }
    for (const [bank, n] of Object.entries(opts.afterSync?.unapproved ?? {})) {
      for (const [acc, b] of links) if (b === bank) unapproved.set(acc, n);
    }
  };
  const syncFails = (route: Route) => {
    const s = opts.afterSync;
    if (s?.status && s.status >= 400) {
      refuse(route, { status: s.status, name: "sync_failed", detail: s.detail ?? "Sync failed" });
      return true;
    }
    return false;
  };

  await page.route(/\/api\/v1\/institutions/, (route) => {
    record(route);
    const url = new URL(route.request().url());
    const list =
      url.pathname.endsWith("/popular") && opts.popular !== false ? [fakeInstitution(1)] : [];
    return json(route, 200, { data: { institutions: list } });
  });

  await page.route(/\/api\/v1\/bank-connections/, async (route) => {
    const body = record(route);
    const req = route.request();
    const url = new URL(req.url());
    if (/\/bank-connections\/link-token$/.test(url.pathname)) {
      return json(route, 200, {
        data: { link_token: "link-test", expiration: "2030-01-01T00:00:00Z" },
      });
    }
    const one = /\/bank-connections\/([^/]+)(\/[a-z-]+)?$/.exec(url.pathname);
    const target = one
      ? connections.find((c) => c.id === decodeURIComponent(one[1] as string))
      : undefined;
    if (one && one[1] !== "link-token" && one[2] !== "/sync") {
      const tail = one[2];
      const method = req.method();
      if (!target)
        return refuse(route, {
          status: 404,
          name: "not_found",
          detail: "Bank connection not found",
        });
      if (!tail && method === "PATCH") {
        if (opts.rename) return refuse(route, opts.rename);
        const nick = String((body as { nickname?: string } | null)?.nickname ?? "").trim();
        target.nickname = nick || (target.institution_name ?? target.nickname);
        return json(route, 200, { data: { bank_connection: connectionJson(target) } });
      }
      if (!tail && method === "DELETE") {
        if (opts.remove) return refuse(route, opts.remove);
        const ids = new Set(target.accounts.map((a) => a.id));
        for (const [acc, bank] of [...links]) if (ids.has(bank)) links.delete(acc);
        connections.splice(connections.indexOf(target), 1);
        return json(route, 200, { data: { deleted: true, plaid: "removed" } });
      }
      if (!tail && method === "GET") {
        return json(route, 200, { data: { bank_connection: connectionJson(target) } });
      }
      if (tail === "/link-token" && method === "POST") {
        if (opts.updateToken) return refuse(route, opts.updateToken);
        return json(route, 200, {
          data: { link_token: "link-update-test", expiration: "2030-01-01T00:00:00Z" },
        });
      }
      if (tail === "/reset" && method === "POST") {
        target.status = "connected";
        target.last_reset_at = new Date().toISOString();
        return json(route, 200, { data: { bank_connection: connectionJson(target) } });
      }
    }
    const sync = /\/bank-connections\/([^/]+)\/sync$/.exec(url.pathname);
    if (sync && req.method() === "POST") {
      if (opts.afterSync?.delayMs) await new Promise((r) => setTimeout(r, opts.afterSync?.delayMs));
      if (syncFails(route)) return;
      const id = decodeURIComponent(sync[1] as string);
      applySync(id);
      return json(route, 200, { data: syncResult(id, opts.afterSync?.result) });
    }
    if (req.method() === "POST") {
      void body;
      if (opts.newConnection) connections.unshift(opts.newConnection);
      const created = opts.newConnection ?? connections[0];
      return json(route, 201, {
        data: { bank_connection: connectionJson(created as FakeConnection) },
      });
    }
    return json(route, 200, { data: { bank_connections: connections.map(connectionJson) } });
  });

  await page.route(new RegExp(`/api/v1/budgets/${opts.budgetId}/sync$`), (route) => {
    record(route);
    if (syncFails(route)) return;
    applySync();
    return json(route, 200, {
      data: { results: connections.map((c) => syncResult(c.id, opts.afterSync?.result)) },
    });
  });

  await page.route(
    new RegExp(`/api/v1/budgets/${opts.budgetId}/accounts/from-bank$`),
    async (route) => {
      const body = record(route) as {
        bank_account_ids: string[];
        overrides?: Record<string, { name?: string; type?: string }>;
        today?: string;
      };
      if (opts.fromBank) return refuse(route, opts.fromBank);
      const created: unknown[] = [];
      for (const id of body.bank_account_ids) {
        const bank = bankAccountById(id);
        if (!bank)
          return refuse(route, { status: 404, name: "not_found", detail: "No such bank account" });
        const o = body.overrides?.[id];
        const res = await request.post(`/api/v1/budgets/${opts.budgetId}/accounts`, {
          headers: await authHeaders(),
          data: {
            name: o?.name ?? bank.name,
            type: o?.type ?? bank.plan_type,
            balance: bank.current_balance ?? 0,
            date: body.today,
          },
        });
        const data = (await res.json()).data as { account: Record<string, unknown> };
        links.set(data.account.id as string, id);
        created.push({ ...data, account: overlay(data.account) });
      }
      return json(route, 201, { data: { created } });
    },
  );

  await page.route(
    new RegExp(`/api/v1/budgets/${opts.budgetId}/accounts/[^/]+/link$`),
    async (route) => {
      const body = record(route) as { bank_account_id?: string } | null;
      const req = route.request();
      const accountId = /accounts\/([^/]+)\/link/.exec(req.url())?.[1] as string;
      if (req.method() === "POST") {
        if (opts.link) return refuse(route, opts.link);
        links.set(accountId, body?.bank_account_id as string);
      } else {
        links.delete(accountId);
      }
      const res = await request.get(`/api/v1/budgets/${opts.budgetId}/accounts/${accountId}`, {
        headers: await authHeaders(),
      });
      const data = (await res.json()).data as { account: Record<string, unknown> };
      return json(route, 200, { data: { account: overlay(data.account) } });
    },
  );

  await page.route(
    new RegExp(
      `/api/v1/budgets/${opts.budgetId}/accounts(\\?[^/]*)?$|/api/v1/budgets/${opts.budgetId}/accounts/[^/?]+$`,
    ),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      // The page may close while this runs (the end of a test): nothing to answer then.
      try {
        const res = await route.fetch();
        const body = await res.json();
        if (body.data?.accounts) body.data.accounts = body.data.accounts.map(overlay);
        if (body.data?.account) body.data.account = overlay(body.data.account);
        await route.fulfill({ response: res, json: body });
      } catch {
        return;
      }
    },
  );

  return { requests, links, connections };
}
