import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../src/env";
import type { McpToolDef } from "../src/mcp/types";
import { call, json, localToken } from "./helpers";

type RouteModule = { default: OpenAPIHono<AppEnv> };

export const routeModules = import.meta.glob<RouteModule>("../src/routes/*.ts", { eager: true });
export const toolModules = import.meta.glob<{ tools: McpToolDef[] }>("../src/mcp/tools/*.ts", {
  eager: true,
});

export function routeFilePaths(mod: RouteModule): string[] {
  const doc = mod.default.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "probe", version: "1" },
  });
  return Object.keys(doc.paths ?? {}).map((p) => `/api/v1${p}`);
}

export function toolFileNames(): string[] {
  return Object.values(toolModules).flatMap((m) => (m.tools ?? []).map((t) => t.name));
}

export async function apiDocument(): Promise<{ openapi: string; paths: Record<string, unknown> }> {
  return (await json("/api/v1/openapi.json")).json();
}

export async function apiPaths(): Promise<string[]> {
  return Object.keys((await apiDocument()).paths);
}

type RpcBody = {
  result?: {
    tools?: { name: string }[];
    structuredContent?: { budget: { id: string }; budgets: { id: string }[] };
  };
};

export async function mcpRpc(
  method: string,
  params: unknown,
  id = 1,
): Promise<{ status: number; body: RpcBody }> {
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

export async function listedToolNames(): Promise<string[]> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  const list = await mcpRpc("tools/list", {}, 2);
  return (list.body.result?.tools ?? []).map((t) => t.name);
}
