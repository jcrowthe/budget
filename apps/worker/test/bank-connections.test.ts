import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkTokenRequest } from "../src/plaid/client";
import { getAccessToken } from "../src/plaid/tokens";
import { json } from "./helpers";
import {
  ALL_SENTINELS,
  createPlan,
  type PlaidHandler,
  SENTINEL,
  seedSandboxCredentials,
  stubPlaid,
} from "./plaid-stub";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

type Json = Record<string, any>;
const clean = (text: string) => ALL_SENTINELS.every((s) => !text.includes(s));

let itemCounter = 0;
const happy = (overrides: Record<string, PlaidHandler> = {}): Record<string, PlaidHandler> => ({
  "/link/token/create": () => ({
    body: { link_token: SENTINEL.linkToken, expiration: "2026-11-16T12:00:00Z" },
  }),
  "/item/public_token/exchange": () => ({
    body: { access_token: SENTINEL.accessToken, item_id: `item-${Date.now()}-${itemCounter++}` },
  }),
  "/accounts/get": () => ({
    body: {
      item: { institution_id: "ins_109508" },
      accounts: [
        {
          account_id: "acc-1",
          name: "ZZ Checking",
          mask: "0000",
          type: "depository",
          subtype: "checking",
          balances: { current: 110.01, available: null, last_updated_datetime: null },
        },
        {
          account_id: "acc-2",
          name: "ZZ Savings",
          mask: "1111",
          type: "depository",
          subtype: "savings",
          balances: { current: -0.3, available: 0.1 + 0.2 },
        },
      ],
    },
  }),
  "/institutions/get_by_id": () => ({
    body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
  }),
  "/item/remove": () => ({ body: { removed: true } }),
  ...overrides,
});

const create = (plan: string) =>
  json(
    "/api/v1/bank-connections",
    { method: "POST" },
    { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
  );

describe("bank connections", () => {
  const logs: string[] = [];
  beforeEach(async () => {
    await seedSandboxCredentials();
    logs.length = 0;
    for (const m of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    }
  });
  afterEach(() => {
    expect(logs.every(clean)).toBe(true);
  });

  it("is in the API and MCP surface", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/bank-connections", "/api/v1/bank-connections/link-token"]),
    );
    expect(await listedToolNames()).toContain("list_bank_connections");
  });

  it("creates a link token without redirect_uri or webhook for Sandbox", async () => {
    const plan = await createPlan("sandbox");
    const calls = stubPlaid(happy());
    const res = await json(
      "/api/v1/bank-connections/link-token",
      { method: "POST" },
      { budget_id: plan },
    );
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Json).data;
    expect(body.link_token).toBe(SENTINEL.linkToken);
    const sent = calls[0]?.body ?? {};
    expect(sent.products).toEqual(["transactions"]);
    expect("redirect_uri" in sent).toBe(false);
    expect("webhook" in sent).toBe(false);
    expect(linkTokenRequest("production", "budget.example")).toMatchObject({
      redirect_uri: "https://budget.example/plaid/oauth",
    });
    expect("webhook" in linkTokenRequest("production", "budget.example")).toBe(false);
  });

  it("creates a connection with milliunit balances, one log row and no leak", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const res = await create(plan);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(clean(text)).toBe(true);
    const conn = (JSON.parse(text) as Json).data.bank_connection;
    expect(conn).toMatchObject({
      status: "connected",
      provider: "Plaid",
      environment: "sandbox",
      institution_name: "ZZ Test Bank",
      nickname: "ZZ Test Bank",
      last_synced_at: null,
    });
    expect(conn.display_id).toMatch(/^[0-9a-f]{6}$/);
    const balances = (conn.accounts as Json[]).map((a) => [a.current_balance, a.available_balance]);
    expect(balances).toEqual([
      [110010, null],
      [-300, 300],
    ]);

    const rows = await env.DB.prepare(
      "select count(*) n from bank_accounts where bank_connection_id = ?",
    )
      .bind(conn.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(2);
    const secret = await env.DB.prepare("select name from secrets where name = ?")
      .bind(`plaid_access_token:${conn.id}`)
      .first();
    expect(secret).not.toBeNull();
    expect(await getAccessToken(env, conn.id)).toBe(SENTINEL.accessToken);

    const log = await env.DB.prepare(
      "select actor, budget_id, action, before_json, after_json from change_log where entity_type='bank_connection' and entity_id = ?",
    )
      .bind(conn.id)
      .all<Json>();
    expect(log.results).toHaveLength(1);
    expect(log.results[0]).toMatchObject({
      actor: "user:tester@localhost",
      budget_id: null,
      action: "create",
      before_json: null,
    });
    expect(clean(JSON.stringify(log.results))).toBe(true);
    const all = await env.DB.prepare("select * from change_log").all();
    expect(clean(JSON.stringify(all.results))).toBe(true);
    const idem = await env.DB.prepare("select * from idempotency_keys").all();
    expect(clean(JSON.stringify(idem.results))).toBe(true);
  });

  it("connecting the same bank twice makes two connections with different display ids", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const a = ((await (await create(plan)).json()) as Json).data.bank_connection;
    const b = ((await (await create(plan)).json()) as Json).data.bank_connection;
    expect(a.display_id).not.toBe(b.display_id);
    const list = ((await (await json(`/api/v1/bank-connections?budget_id=${plan}`)).json()) as Json)
      .data.bank_connections as Json[];
    expect(list.filter((c) => [a.id, b.id].includes(c.id))).toHaveLength(2);
    expect(list.map((c) => c.id).indexOf(b.id)).toBeLessThan(list.map((c) => c.id).indexOf(a.id));
  });

  it("a failure after the exchange writes nothing and removes the item", async () => {
    const plan = await createPlan("sandbox");
    const secretsBefore = await env.DB.prepare(
      "select count(*) n from secrets where name like 'plaid_access_token:%'",
    ).first<{ n: number }>();
    const before = await env.DB.prepare("select count(*) n from bank_connections").first<{
      n: number;
    }>();
    const calls = stubPlaid(
      happy({
        "/accounts/get": () => ({ status: 500, body: { error_code: "INTERNAL_SERVER_ERROR" } }),
      }),
    );
    const res = await create(plan);
    expect(res.status).toBe(502);
    expect(clean(await res.text())).toBe(true);
    const after = await env.DB.prepare("select count(*) n from bank_connections").first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
    const secrets = await env.DB.prepare(
      "select count(*) n from secrets where name like 'plaid_access_token:%'",
    ).first<{ n: number }>();
    expect(secrets?.n).toBe(secretsBefore?.n);
    expect(calls.some((c) => c.url.endsWith("/item/remove"))).toBe(true);
  });

  it("keeps sandbox and production connections apart", async () => {
    const sandboxPlan = await createPlan("sandbox");
    const prodPlan = await createPlan();
    stubPlaid(happy());
    const conn = ((await (await create(sandboxPlan)).json()) as Json).data.bank_connection;
    const inProd = (
      (await (await json(`/api/v1/bank-connections?budget_id=${prodPlan}`)).json()) as Json
    ).data.bank_connections as Json[];
    expect(inProd.some((c) => c.id === conn.id)).toBe(false);

    const prodId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, created_at, updated_at) values (?, 'abcdef', 'production', 'item-prod', 'ins_1', 'ZZ Prod', 'ZZ Prod', 'connected', 'Plaid', ?, ?)",
    )
      .bind(prodId, now, now)
      .run();
    const inSandbox = (
      (await (await json(`/api/v1/bank-connections?budget_id=${sandboxPlan}`)).json()) as Json
    ).data.bank_connections as Json[];
    expect(inSandbox.some((c) => c.id === prodId)).toBe(false);
    const inProd2 = (
      (await (await json(`/api/v1/bank-connections?budget_id=${prodPlan}`)).json()) as Json
    ).data.bank_connections as Json[];
    expect(inProd2.some((c) => c.id === prodId)).toBe(true);
    await env.DB.prepare("delete from bank_connections where id = ?").bind(prodId).run();
  });

  it("MCP list_bank_connections returns the connection without a secret", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const conn = ((await (await create(plan)).json()) as Json).data.bank_connection;
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const mcp = await mcpRpc(
      "tools/call",
      { name: "list_bank_connections", arguments: { budget_id: plan } },
      2,
    );
    expect(clean(JSON.stringify(mcp.body))).toBe(true);
    const list = ((mcp.body.result?.structuredContent ?? {}) as Json).bank_connections as Json[];
    expect(list.some((c) => c.id === conn.id)).toBe(true);
  });
});
