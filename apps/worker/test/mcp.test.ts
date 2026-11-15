import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { listedToolNames, mcpRpc, toolFileNames, toolModules } from "./surface";

describe("mcp", () => {
  it("lists tools and creates a budget with an mcp actor", async () => {
    const init = await mcpRpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
      1,
    );
    expect(init.status).toBe(200);
    const list = await mcpRpc("tools/list", {}, 2);
    const names = (list.body.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["create_budget", "list_budgets"]));
    const created = await mcpRpc(
      "tools/call",
      { name: "create_budget", arguments: { name: "ZZ-TEST M" } },
      3,
    );
    const created_budget = created.body.result?.structuredContent?.budget as { id: string };
    const id = created_budget.id;
    const row = await env.DB.prepare("SELECT actor FROM change_log WHERE entity_id = ?")
      .bind(id)
      .first<{ actor: string }>();
    expect(row?.actor.startsWith("mcp:user:")).toBe(true);
    const listed = await mcpRpc("tools/call", { name: "list_budgets", arguments: {} }, 4);
    const budgets = listed.body.result?.structuredContent?.budgets as { id: string }[];
    expect(budgets.map((b) => b.id)).toContain(id);
    expect(budgets.find((b) => b.id === id)).toHaveProperty("last_opened_at", null);
  });

  it("the tool glob finds tool files", () => {
    expect(Object.keys(toolModules).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(toolModules).sort())("tool file %s exports at least one tool", (file) => {
    const tools = toolModules[file]?.tools ?? [];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("no two tools share a name", () => {
    const names = toolFileNames();
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(dupes).toEqual([]);
  });

  it("tools/list lists exactly the tools the tool files export", async () => {
    expect((await listedToolNames()).sort()).toEqual([...toolFileNames()].sort());
  });
});
