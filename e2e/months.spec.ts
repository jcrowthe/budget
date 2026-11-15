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

test("month read model: empty plan over REST and MCP, bad month is 422", async ({ request }) => {
  const headers = await authHeaders();
  const created = await request.post("/api/v1/budgets", {
    headers,
    data: { name: testName("months") },
  });
  const { id } = (await created.json()).data.budget;
  const month = `${new Date().toISOString().slice(0, 7)}-01`;

  const res = await request.get(`/api/v1/budgets/${id}/months/${month}`, { headers });
  expect(res.status()).toBe(200);
  const { data } = await res.json();
  expect(data).toMatchObject({ month, ready_to_assign: 0, groups: [], uncategorized: null });

  await rpc(
    request,
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    1,
  );
  const viaMcp = await rpc(
    request,
    "tools/call",
    { name: "get_plan_month", arguments: { budget_id: id, month } },
    2,
  );
  expect(viaMcp.result.structuredContent).toEqual(data);

  const bad = await request.get(`/api/v1/budgets/${id}/months/${month.slice(0, 8)}15`, { headers });
  expect(bad.status()).toBe(422);
  await request.delete(`/api/v1/budgets/${id}`, { headers });
});
