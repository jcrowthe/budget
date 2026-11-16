import { z } from "zod";
import { listBankConnections } from "../../services/bank-connections";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_bank_connections",
    description:
      "List the bank connections (Plaid) for the plan's bank environment, with their bank accounts. Read only; no secret is ever returned.",
    inputSchema: z.object({ budget_id: z.uuid() }),
    run: async (input: { budget_id: string }, { env }) => ({
      bank_connections: await listBankConnections(env, input.budget_id),
    }),
  },
];
