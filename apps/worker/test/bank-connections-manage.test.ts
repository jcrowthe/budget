import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkTokenUpdateRequest } from "../src/plaid/client";
import { getAccessToken, storeAccessToken } from "../src/plaid/tokens";
import { resetAvailableAt } from "../src/services/bank-connections";
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

const BC = "/api/v1/bank-connections";
const q = (plan: string) => `?budget_id=${plan}`;
const get = async (plan: string, id: string) => json(`${BC}/${id}${q(plan)}`);
const patch = (plan: string, id: string, nickname: string) =>
  json(`${BC}/${id}${q(plan)}`, { method: "PATCH" }, { nickname });
const del = (plan: string, id: string) => json(`${BC}/${id}${q(plan)}`, { method: "DELETE" });
const post = (plan: string, id: string, path: string) =>
  json(`${BC}/${id}/${path}${q(plan)}`, { method: "POST" });
const data = async (res: Response) => ((await res.json()) as Json).data;
const logRows = async (id: string) =>
  (
    await env.DB.prepare(
      "select actor, budget_id, action, before_json, after_json from change_log where entity_type='bank_connection' and entity_id = ? order by created_at, rowid",
    )
      .bind(id)
      .all<Json>()
  ).results;
const rowCount = async (sql: string, ...b: string[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .first<{ n: number }>()
  )?.n;

async function connect(plan: string) {
  const res = await create(plan);
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.bank_connection as Json;
}
async function mcp(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

describe("bank connections: read, rename, reset, remove", () => {
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
  afterEach(async () => {
    expect(logs.every(clean)).toBe(true);
    const all = await env.DB.prepare("select * from change_log").all();
    expect(clean(JSON.stringify(all.results))).toBe(true);
    const idem = await env.DB.prepare("select * from idempotency_keys").all();
    expect(clean(JSON.stringify(idem.results))).toBe(true);
  });

  it("is in the API and MCP surface", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/bank-connections/{id}",
        "/api/v1/bank-connections/{id}/link-token",
        "/api/v1/bank-connections/{id}/reset",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "get_bank_connection",
        "rename_bank_connection",
        "remove_bank_connection",
      ]),
    );
  });

  it("reads one connection, the same as the list", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const c = await connect(plan);
    const res = await get(plan, c.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(clean(text)).toBe(true);
    const one = JSON.parse(text).data.bank_connection as Json;
    expect(one).toMatchObject({
      display_id: c.display_id,
      nickname: "ZZ Test Bank",
      institution_name: "ZZ Test Bank",
      status: "connected",
      provider: "Plaid",
      last_synced_at: null,
      last_reset_at: null,
    });
    expect(one.accounts).toHaveLength(2);
    expect((one.accounts as Json[]).every((a) => a.linked_account_id === null)).toBe(true);
    const list = (await data(await json(`${BC}${q(plan)}`))).bank_connections as Json[];
    expect(list.find((x) => x.id === c.id)).toEqual(one);
    expect((await get(plan, crypto.randomUUID())).status).toBe(404);
  });

  it("renames, falls back to the bank's name, writes nothing when unchanged, refuses 101", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const c = await connect(plan);
    const res = await patch(plan, c.id, "ZZ Renamed");
    expect(res.status).toBe(200);
    expect((await data(res)).bank_connection.nickname).toBe("ZZ Renamed");
    expect((await data(await get(plan, c.id))).bank_connection.nickname).toBe("ZZ Renamed");
    const list = (await data(await json(`${BC}${q(plan)}`))).bank_connections as Json[];
    expect(list.find((x) => x.id === c.id)?.nickname).toBe("ZZ Renamed");
    let rows = await logRows(c.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      actor: "user:tester@localhost",
      budget_id: null,
      action: "update",
    });
    expect(JSON.parse(rows[1]?.before_json).nickname).toBe("ZZ Test Bank");
    expect(JSON.parse(rows[1]?.after_json).nickname).toBe("ZZ Renamed");

    const updated = async () =>
      (
        await env.DB.prepare("select updated_at u from bank_connections where id = ?")
          .bind(c.id)
          .first<{ u: string }>()
      )?.u;
    const u0 = await updated();
    expect((await patch(plan, c.id, "ZZ Renamed")).status).toBe(200);
    expect(await updated()).toBe(u0);
    expect(await logRows(c.id)).toHaveLength(2);

    const blank = await patch(plan, c.id, "   ");
    expect(blank.status).toBe(200);
    expect((await data(blank)).bank_connection.nickname).toBe("ZZ Test Bank");
    rows = await logRows(c.id);
    expect(rows).toHaveLength(3);
    expect((await patch(plan, c.id, "x".repeat(100))).status).toBe(200);
    expect((await patch(plan, c.id, "x".repeat(101))).status).toBe(422);
    expect((await patch(plan, crypto.randomUUID(), "a")).status).toBe(404);
  });

  it("removes at Plaid, the token, the rows; once", async () => {
    const plan = await createPlan("sandbox");
    const calls = stubPlaid(happy());
    const c = await connect(plan);
    await patch(plan, c.id, "ZZ Gone");
    const res = await del(plan, c.id);
    expect(res.status).toBe(200);
    expect(await data(res)).toEqual({ deleted: true, plaid: "removed" });
    const removes = calls.filter((x) => x.url.endsWith("/item/remove"));
    expect(removes).toHaveLength(1);
    expect(removes[0]?.url).toContain("sandbox.plaid.com");
    expect(removes[0]?.body.access_token).toBe(SENTINEL.accessToken);
    expect(
      await rowCount("select count(*) n from secrets where name = ?", `plaid_access_token:${c.id}`),
    ).toBe(0);
    expect(await rowCount("select count(*) n from bank_connections where id = ?", c.id)).toBe(0);
    expect(
      await rowCount("select count(*) n from bank_accounts where bank_connection_id = ?", c.id),
    ).toBe(0);
    const list = (await data(await json(`${BC}${q(plan)}`))).bank_connections as Json[];
    expect(list.some((x) => x.id === c.id)).toBe(false);
    const rows = await logRows(c.id);
    expect(rows.at(-1)).toMatchObject({ action: "delete", after_json: null });
    expect(rows.at(-1)?.before_json).toContain("ZZ Gone");
    expect((await del(plan, c.id)).status).toBe(404);
  });

  it.each(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"])(
    "removes locally when Plaid says %s",
    async (code) => {
      const plan = await createPlan("sandbox");
      stubPlaid(happy({ "/item/remove": () => ({ status: 400, body: { error_code: code } }) }));
      const c = await connect(plan);
      const res = await del(plan, c.id);
      expect(res.status).toBe(200);
      expect(await data(res)).toEqual({ deleted: true, plaid: "already_removed" });
      expect(await rowCount("select count(*) n from bank_connections where id = ?", c.id)).toBe(0);
      expect(
        await rowCount(
          "select count(*) n from secrets where name = ?",
          `plaid_access_token:${c.id}`,
        ),
      ).toBe(0);
    },
  );

  it("removes nothing when Plaid fails, and can be retried", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const c = await connect(plan);
    for (const how of ["500", "network"]) {
      if (how === "500") {
        stubPlaid(
          happy({
            "/item/remove": () => ({ status: 500, body: { error_code: "INTERNAL_SERVER_ERROR" } }),
          }),
        );
      } else {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
      }
      const res = await del(plan, c.id);
      expect(res.status).toBe(502);
      const body = JSON.parse(await res.text());
      expect(body.error.name).toBe("plaid_remove_failed");
      expect(body.error.detail).toBe(
        "The bank connection could not be removed at Plaid. Nothing was changed. Try again.",
      );
      expect(await rowCount("select count(*) n from bank_connections where id = ?", c.id)).toBe(1);
      expect(
        await rowCount("select count(*) n from bank_accounts where bank_connection_id = ?", c.id),
      ).toBe(2);
      expect(
        await rowCount(
          "select count(*) n from secrets where name = ?",
          `plaid_access_token:${c.id}`,
        ),
      ).toBe(1);
      expect((await logRows(c.id)).some((r) => r.action === "delete")).toBe(false);
      vi.restoreAllMocks();
    }
    stubPlaid(happy());
    expect((await del(plan, c.id)).status).toBe(200);
  });

  it("update-mode token carries the access token and no products; 24 hours between resets", async () => {
    const plan = await createPlan("sandbox");
    const calls = stubPlaid(happy());
    const c = await connect(plan);
    const tok = await post(plan, c.id, "link-token");
    expect(tok.status).toBe(200);
    const text = await tok.text();
    expect(JSON.parse(text).data.link_token).toBe(SENTINEL.linkToken);
    const sent = calls.filter((x) => x.url.endsWith("/link/token/create")).at(-1)?.body ?? {};
    expect(sent.access_token).toBe(SENTINEL.accessToken);
    expect("products" in sent).toBe(false);
    expect("webhook" in sent).toBe(false);
    expect("redirect_uri" in sent).toBe(false);
    expect(Object.keys(linkTokenUpdateRequest("production", "b.example", "t")).sort()).toEqual([
      "access_token",
      "client_name",
      "country_codes",
      "language",
      "redirect_uri",
      "user",
    ]);

    const reset = await post(plan, c.id, "reset");
    expect(reset.status).toBe(200);
    const r = (await data(reset)).bank_connection as Json;
    expect(r.status).toBe("connected");
    expect(r.last_reset_at).toEqual(expect.any(String));
    expect((await logRows(c.id)).filter((x) => x.action === "update")).toHaveLength(1);

    const n = calls.length;
    const again = await post(plan, c.id, "link-token");
    expect(again.status).toBe(409);
    expect(JSON.parse(await again.text()).error.name).toBe("reset_too_soon");
    expect(calls.length).toBe(n);

    const setReset = (ms: number) =>
      env.DB.prepare("update bank_connections set last_reset_at = ? where id = ?")
        .bind(new Date(Date.now() + ms).toISOString(), c.id)
        .run();
    await setReset(-24 * 3600_000 - 60_000);
    expect((await post(plan, c.id, "link-token")).status).toBe(200);
    await setReset(-24 * 3600_000 + 60_000);
    expect((await post(plan, c.id, "link-token")).status).toBe(409);

    expect(resetAvailableAt(null)).toBeNull();
    const t = Date.parse("2026-11-16T00:00:00Z");
    expect(resetAvailableAt("2026-11-15T00:00:00Z", t)).toBeNull();
    expect(resetAvailableAt("2026-11-15T00:00:01Z", t)).toBe("2026-11-16T00:00:01.000Z");

    await env.DB.prepare("delete from secrets where name = ?")
      .bind(`plaid_access_token:${c.id}`)
      .run();
    await setReset(-48 * 3600_000);
    const broken = await post(plan, c.id, "link-token");
    expect(broken.status).toBe(409);
    expect(JSON.parse(await broken.text()).error.name).toBe("bank_connection_broken");
  });

  it("MCP read, rename and remove match REST and log an mcp actor", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid(happy());
    const c = await connect(plan);
    const listed = await mcp("list_bank_connections", { budget_id: plan });
    expect(clean(JSON.stringify(listed))).toBe(true);
    const rest = (await data(await json(`${BC}${q(plan)}`))).bank_connections as Json[];
    const fromMcp = (listed.structuredContent as Json).bank_connections as Json[];
    expect(fromMcp.find((x) => x.id === c.id)).toEqual(rest.find((x) => x.id === c.id));
    const one = await mcp("get_bank_connection", { budget_id: plan, bank_connection_id: c.id });
    expect((one.structuredContent as Json).bank_connection).toEqual(
      (await data(await get(plan, c.id))).bank_connection,
    );
    const ren = await mcp("rename_bank_connection", {
      budget_id: plan,
      bank_connection_id: c.id,
      nickname: "ZZ By Agent",
    });
    expect((ren.structuredContent as Json).bank_connection.nickname).toBe("ZZ By Agent");
    const rm = await mcp("remove_bank_connection", { budget_id: plan, bank_connection_id: c.id });
    expect(rm.structuredContent).toEqual({ deleted: true, plaid: "removed" });
    expect(clean(JSON.stringify([ren, rm]))).toBe(true);
    const rows = await logRows(c.id);
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(rows[1]?.actor.startsWith("mcp:")).toBe(true);
    expect(rows[2]?.actor.startsWith("mcp:")).toBe(true);
    const gone = await mcp("get_bank_connection", { budget_id: plan, bank_connection_id: c.id });
    expect(gone.isError).toBe(true);
    expect(JSON.stringify(gone.content)).toContain("Bank connection not found");
  });

  it("a connection of the other environment is not found, and nothing is called", async () => {
    const sandboxPlan = await createPlan("sandbox");
    const prodPlan = await createPlan();
    const calls = stubPlaid(happy());
    const prodId = crypto.randomUUID();
    const now = new Date().toISOString();
    const display = crypto
      .randomUUID()
      .slice(0, 6)
      .replace(/[^0-9a-f]/g, "a");
    await env.DB.prepare(
      "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, created_at, updated_at) values (?, ?, 'production', ?, 'ins_1', 'ZZ Prod', 'ZZ Prod', 'connected', 'Plaid', ?, ?)",
    )
      .bind(prodId, display, crypto.randomUUID(), now, now)
      .run();
    await storeAccessToken(env, prodId, "ZZ-FAKE-TOKEN");
    try {
      const results = await Promise.all([
        get(sandboxPlan, prodId),
        patch(sandboxPlan, prodId, "x"),
        post(sandboxPlan, prodId, "link-token"),
        post(sandboxPlan, prodId, "reset"),
        del(sandboxPlan, prodId),
      ]);
      expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
      expect(calls).toHaveLength(0);
      expect(await rowCount("select count(*) n from bank_connections where id = ?", prodId)).toBe(
        1,
      );
      const list = (await data(await json(`${BC}${q(sandboxPlan)}`))).bank_connections as Json[];
      expect(list.some((x) => x.id === prodId)).toBe(false);

      // A production plan cannot reach Plaid here (tests never run as production): refused, nothing removed.
      const res = await del(prodPlan, prodId);
      expect(res.status).toBe(422);
      expect(JSON.parse(await res.text()).error.name).toBe("bank_connections_not_set_up");
      expect(await rowCount("select count(*) n from bank_connections where id = ?", prodId)).toBe(
        1,
      );
      expect(
        await rowCount(
          "select count(*) n from secrets where name = ?",
          `plaid_access_token:${prodId}`,
        ),
      ).toBe(1);
      expect(calls).toHaveLength(0);

      stubPlaid(happy());
      const sandboxConn = await connect(sandboxPlan);
      expect((await get(prodPlan, sandboxConn.id)).status).toBe(404);
      expect((await del(prodPlan, sandboxConn.id)).status).toBe(404);
    } finally {
      await env.DB.prepare("delete from bank_connections where id = ?").bind(prodId).run();
      await env.DB.prepare("delete from secrets where name = ?")
        .bind(`plaid_access_token:${prodId}`)
        .run();
    }
  });
});
