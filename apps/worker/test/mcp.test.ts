import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, localToken } from "./helpers";

async function rpc(method: string, params: unknown, id = 1) {
  const res = await call("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Cf-Access-Jwt-Assertion": await localToken(),
      Host: "localhost",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  const data =
    text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
      ? text
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
      : text;
  return { status: res.status, body: JSON.parse(data ?? "{}") };
}

describe("mcp", () => {
  it("lists tools and creates a budget with an mcp actor", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    const list = await rpc("tools/list", {}, 2);
    const names = (list.body.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(["create_budget", "list_budgets"]);
    const created = await rpc(
      "tools/call",
      { name: "create_budget", arguments: { name: "ZZ-TEST M" } },
      3,
    );
    const id = created.body.result.structuredContent.budget.id as string;
    const row = await env.DB.prepare("SELECT actor FROM change_log WHERE entity_id = ?")
      .bind(id)
      .first<{ actor: string }>();
    expect(row?.actor.startsWith("mcp:user:")).toBe(true);
    const listed = await rpc("tools/call", { name: "list_budgets", arguments: {} }, 4);
    expect(
      (listed.body.result.structuredContent.budgets as { id: string }[]).map((b) => b.id),
    ).toContain(id);
  });
});
