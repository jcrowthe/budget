import { z } from "zod";
import {
  getBankConnection,
  listBankConnections,
  removeBankConnection,
  renameBankConnection,
} from "../../services/bank-connections";
import { Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

const FIELDS =
  "id, display_id, institution_name, nickname, status, provider, last_synced_at, last_reset_at and accounts (each with id, name, mask, type, subtype, current_balance and available_balance, null when unknown, and linked_account_id (the account of this plan linked to it, or null))";

export const tools: McpToolDef[] = [
  {
    name: "list_bank_connections",
    description: `List the bank connections (Plaid) of the plan's bank environment, with their bank accounts. Read only; no secret is ever returned. ${MONEY} Returns { bank_connections }: each with ${FIELDS}.`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      bank_connections: await listBankConnections(env, input.budget_id),
    }),
  },
  {
    name: "get_bank_connection",
    description: `Get one bank connection (Plaid) of the plan's bank environment, with its bank accounts. Read only; no secret (no access token) is returned. ${MONEY} Returns { bank_connection } with ${FIELDS}. An unknown id, or one of the other environment, is an error.`,
    inputSchema: z.object({ budget_id: Id, bank_connection_id: Id }),
    run: async (input: { budget_id: string; bank_connection_id: string }, { env }) => ({
      bank_connection: await getBankConnection(env, input.budget_id, input.bank_connection_id),
    }),
  },
  {
    name: "rename_bank_connection",
    description: `Change the nickname of a bank connection. At most 100 characters; a blank nickname uses the bank's own name; an unchanged nickname writes nothing. No secret (no access token) is returned. ${MONEY} Returns { bank_connection } as get_bank_connection does, with the new nickname.`,
    inputSchema: z.object({ budget_id: Id, bank_connection_id: Id, nickname: z.string().max(100) }),
    run: async (
      input: { budget_id: string; bank_connection_id: string; nickname: string },
      { env, actor },
    ) => ({
      bank_connection: await renameBankConnection(env, actor, {
        budget_id: input.budget_id,
        id: input.bank_connection_id,
        nickname: input.nickname,
      }),
    }),
  },
  {
    name: "remove_bank_connection",
    description:
      "Remove a bank connection. This removes it at Plaid (the bank stops sharing data with Budget) and in Budget: the stored access token, the connection and its bank accounts. It cannot be undone; connecting the bank again makes a new connection. No transaction and no plan account is deleted. If Plaid cannot be reached nothing is removed (tool error); try again. Returns { deleted: true, plaid } where plaid is removed or already_removed. No secret is returned.",
    inputSchema: z.object({ budget_id: Id, bank_connection_id: Id }),
    run: async (input: { budget_id: string; bank_connection_id: string }, { env, actor }) =>
      removeBankConnection(env, actor, input.budget_id, input.bank_connection_id),
  },
];
