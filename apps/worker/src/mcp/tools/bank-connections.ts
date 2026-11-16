import { z } from "zod";
import { listBankConnections } from "../../services/bank-connections";
import { Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_bank_connections",
    description: `List the bank connections (Plaid) of the plan's bank environment, with their bank accounts. Read only; no secret is ever returned. ${MONEY} Returns { bank_connections }: each with id, institution_name, nickname, status, last_synced_at and accounts (each with id, name, mask, type, subtype, current_balance and available_balance, null when unknown).`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      bank_connections: await listBankConnections(env, input.budget_id),
    }),
  },
];
