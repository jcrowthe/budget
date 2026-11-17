import { env } from "cloudflare:test";
import { planBalanceOf } from "@budget/schema/bank-link";
import { beforeEach, describe, expect, it } from "vitest";
import { bankBalanceToPlan } from "../src/plaid/amounts";
import { json } from "./helpers";
import { createPlan, SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";
import { mcpRpc } from "./surface";

type Json = Record<string, any>;
const A = (plan: string) => `/api/v1/budgets/${plan}/accounts`;
const data = async (res: Response) => ((await res.json()) as Json).data;

describe("bank link: connection_status and last_synced_at on the account read", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-read-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: [
            {
              account_id: `acc-${crypto.randomUUID()}`,
              name: "ZZ Checking",
              mask: "0000",
              type: "depository",
              subtype: "checking",
              balances: { current: 10, available: null },
            },
          ],
        },
      }),
      "/institutions/get_by_id": () => ({
        body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
      }),
    });
  });

  it("is null/null unlinked, follows the connection once linked, and is null again after unlink", async () => {
    const plan = await createPlan("sandbox");
    const plain = (
      await data(
        await json(A(plan), { method: "POST" }, { name: "ZZ Plain", type: "checking", balance: 0 }),
      )
    ).account;
    expect(plain.connection_status).toBeNull();
    expect(plain.last_synced_at).toBeNull();

    const conn = await data(
      await json(
        "/api/v1/bank-connections",
        { method: "POST" },
        { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
      ),
    );
    const connection = (conn.bank_connection ?? conn) as Json;
    const bankId = connection.accounts[0].id as string;
    const res = await json(
      `${A(plan)}/from-bank`,
      { method: "POST" },
      { bank_account_ids: [bankId] },
    );
    expect(res.status).toBe(201);
    const created = (await data(res)).created[0].account as Json;
    expect(created.connection_status).toBe("connected");
    const id = created.id as string;
    const read = async () => ({
      get: (await data(await json(`${A(plan)}/${id}`))).account as Json,
      list: ((await data(await json(A(plan)))).accounts as Json[]).find((a) => a.id === id) as Json,
    });
    const first = await read();
    expect(first.get.connection_status).toBe("connected");
    expect(first.list.connection_status).toBe("connected");

    await env.DB.prepare(
      "update bank_connections set status = 'login_required', last_synced_at = ? where id = ?",
    )
      .bind("2026-11-16T08:00:00.000Z", connection.id as string)
      .run();
    const changed = await read();
    for (const a of [changed.get, changed.list]) {
      expect(a.connection_status).toBe("login_required");
      expect(a.last_synced_at).toBe("2026-11-16T08:00:00.000Z");
    }
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const tool = (
      (await mcpRpc("tools/call", { name: "list_accounts", arguments: { budget_id: plan } }, 2))
        .body.result as Json
    ).structuredContent.accounts.find((a: Json) => a.id === id);
    expect(tool.connection_status).toBe("login_required");
    expect(tool.last_synced_at).toBe("2026-11-16T08:00:00.000Z");

    const un = (await data(await json(`${A(plan)}/${id}/link`, { method: "DELETE" }))).account;
    expect(un.connection_status).toBeNull();
    expect(un.last_synced_at).toBeNull();
    const after = await read();
    expect(after.get.connection_status).toBeNull();
    expect(after.list.last_synced_at).toBeNull();
  });

  it("planBalanceOf agrees with the Worker's bankBalanceToPlan", () => {
    for (const [t, m] of [
      ["depository", 125050],
      ["credit", 42025],
      ["loan", 0],
      ["depository", null],
      ["loan", 5000],
      ["investment", -7],
    ] as const) {
      expect(planBalanceOf(t, m)).toBe(bankBalanceToPlan(t, m));
    }
  });
});
