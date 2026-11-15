import type { z } from "zod";
import type { Env } from "../env";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  run(input: never, ctx: { env: Env; actor: string }): Promise<unknown>;
}
