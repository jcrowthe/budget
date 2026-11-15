import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

async function rpc(
  request: import("@playwright/test").APIRequestContext,
  method: string,
  params: unknown,
  id: number,
) {
  const res = await request.post("/mcp", {
    headers: await authHeaders({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }),
    data: { jsonrpc: "2.0", id, method, params },
  });
  expect(res.status()).toBe(200);
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
}

test("MCP lists tools, creates a plan that REST then shows", async ({ request }) => {
  await rpc(
    request,
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    1,
  );
  const tools = await rpc(request, "tools/list", {}, 2);
  expect(tools.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
    "create_budget",
    "list_budgets",
  ]);
  const name = testName("mcp");
  const created = await rpc(
    request,
    "tools/call",
    { name: "create_budget", arguments: { name } },
    3,
  );
  const id = created.result.structuredContent.budget.id;
  const got = await request.get(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
  expect((await got.json()).data.budget.name).toBe(name);
  const listed = await rpc(request, "tools/call", { name: "list_budgets", arguments: {} }, 4);
  expect(listed.result.structuredContent.budgets.map((b: { id: string }) => b.id)).toContain(id);
});
