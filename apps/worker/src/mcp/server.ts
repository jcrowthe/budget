import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { logToolError } from "../middleware/errors";
import type { McpToolDef } from "./types";

// Every module in mcp/tools/ exports `tools: McpToolDef[]`.
const toolModules = import.meta.glob<{ tools: McpToolDef[] }>("./tools/*.ts", { eager: true });

function allTools(): McpToolDef[] {
  return Object.keys(toolModules)
    .sort()
    .flatMap((k) => toolModules[k]?.tools ?? []);
}

export function createServerFactory(env: Env) {
  return () => {
    const server = new McpServer({ name: "budget", version: "1" });
    for (const tool of allTools()) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (input: unknown) => {
          const actor = `mcp:${String(getMcpAuthContext()?.props.actor ?? "unknown")}`;
          let result: unknown;
          try {
            result = await tool.run(input as never, { env, actor });
          } catch (e) {
            logToolError(tool.name, e);
            throw e;
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        },
      );
    }
    return server;
  };
}

export async function mcpRoute(c: Context<AppEnv>): Promise<Response> {
  const hostnames = [c.env.PUBLIC_HOSTNAME];
  if (c.env.ENVIRONMENT === "local") hostnames.push("localhost");
  const handler = createMcpHandler(createServerFactory(c.env), {
    route: "/mcp",
    allowedHostnames: hostnames,
    authContext: { props: { actor: c.get("identity").actor } },
  });
  // agents types ExecutionContext from a newer runtime typing than workers-types ships.
  return handler(c.req.raw, c.env, c.executionCtx as never);
}
