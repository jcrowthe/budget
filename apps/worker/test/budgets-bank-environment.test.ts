import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

type Json = Record<string, any>;
const name = () => `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
const post = async (body: Json) =>
  (await json("/api/v1/budgets", { method: "POST" }, body)).json() as Promise<Json>;

describe("budget bank_environment", () => {
  it("defaults to production in POST, GET, list and MCP list_budgets", async () => {
    const created = await post({ name: name() });
    const id = created.data.budget.id;
    expect(created.data.budget.bank_environment).toBe("production");
    const got = (await (await json(`/api/v1/budgets/${id}`)).json()) as Json;
    expect(got.data.budget.bank_environment).toBe("production");
    const list = (await (await json("/api/v1/budgets")).json()) as Json;
    expect(list.data.budgets.find((b: Json) => b.id === id).bank_environment).toBe("production");
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const mcp = await mcpRpc("tools/call", { name: "list_budgets", arguments: {} }, 2);
    const budgets = ((mcp.body.result?.structuredContent ?? {}) as Json).budgets as Json[];
    expect(budgets.find((b) => b.id === id)?.bank_environment).toBe("production");
  });

  it("can be set on create (REST and MCP)", async () => {
    const created = await post({ name: name(), bank_environment: "sandbox" });
    expect(created.data.budget.bank_environment).toBe("sandbox");
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const mcp = await mcpRpc(
      "tools/call",
      { name: "create_budget", arguments: { name: name(), bank_environment: "sandbox" } },
      3,
    );
    expect(
      (((mcp.body.result?.structuredContent ?? {}) as Json).budget as Json).bank_environment,
    ).toBe("sandbox");
  });

  it("PATCH changes it with one logged update; a name-only PATCH keeps it", async () => {
    const id = (await post({ name: name() })).data.budget.id;
    const patch = (body: Json) => json(`/api/v1/budgets/${id}`, { method: "PATCH" }, body);
    expect((await patch({ bank_environment: "sandbox" })).status).toBe(200);
    const rows = await env.DB.prepare(
      "select action, before_json, after_json from change_log where entity_type='budget' and entity_id=? and action='update'",
    )
      .bind(id)
      .all<{ before_json: string; after_json: string }>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.parse(rows.results[0]?.before_json ?? "{}").bank_environment).toBe("production");
    expect(JSON.parse(rows.results[0]?.after_json ?? "{}").bank_environment).toBe("sandbox");
    const renamed = (await (await patch({ name: name() })).json()) as Json;
    expect(renamed.data.budget.bank_environment).toBe("sandbox");
  });

  it("PATCH {opened, bank_environment} changes it; an invalid value is a 400", async () => {
    const id = (await post({ name: name() })).data.budget.id;
    const res = await json(
      `/api/v1/budgets/${id}`,
      { method: "PATCH" },
      { opened: true, bank_environment: "sandbox" },
    );
    expect(((await res.json()) as Json).data.budget.bank_environment).toBe("sandbox");
    const bad = await json(`/api/v1/budgets/${id}`, { method: "PATCH" }, { bank_environment: "x" });
    expect(bad.status).toBe(400);
  });
});
