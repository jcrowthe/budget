import { z } from "zod";
import {
  getBankConnection,
  listBankConnections,
  removeBankConnection,
  renameBankConnection,
} from "../../services/bank-connections";
import { syncBankConnection, syncPlan } from "../../services/plaid-sync";
import { Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const FIELDS =
  "id, display_id, institution_name, nickname, status, provider, last_synced_at, last_reset_at, sync_failed_at (when the last sync that failed in Budget ended, null once a sync finishes) and accounts (each with id, name, mask, type, subtype, current_balance and available_balance, null when unknown, and linked_account_id (the account of this plan linked to it, or null)). status is connected; delayed (the bank did not answer, Budget tries again on its own; when last_synced_at is more than 3 days old, suggest Reset in Bank Connections); login_required (the owner must sign in to the bank again with Repair, in the app's Bank Connections or on the account's page; an agent cannot do it); or broken (cannot be repaired: the owner removes the connection in Bank Connections and connects the bank again)";

export const tools: McpToolDef[] = [
  {
    name: "list_bank_connections",
    description: `List the bank connections (Plaid) of the plan's bank environment, with their bank accounts. Read only; no secret is ever returned. ${MONEY} Returns { bank_connections }: each with ${FIELDS}. ${timestamps(["last_synced_at", "last_reset_at", "sync_failed_at", "created_at", "balance_updated_at"], ["last_synced_at", "last_reset_at", "sync_failed_at", "balance_updated_at"])}`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      bank_connections: await listBankConnections(env, input.budget_id),
    }),
  },
  {
    name: "get_bank_connection",
    description: `Get one bank connection (Plaid) of the plan's bank environment, with its bank accounts. Read only; no secret (no access token) is returned. ${MONEY} Returns { bank_connection } with ${FIELDS}. An unknown id, or one of the other environment, is an error. ${timestamps(["last_synced_at", "last_reset_at", "sync_failed_at", "created_at", "balance_updated_at"], ["last_synced_at", "last_reset_at", "sync_failed_at", "balance_updated_at"])}`,
    inputSchema: z.object({ budget_id: Id, bank_connection_id: Id }),
    run: async (input: { budget_id: string; bank_connection_id: string }, { env }) => ({
      bank_connection: await getBankConnection(env, input.budget_id, input.bank_connection_id),
    }),
  },
  {
    name: "rename_bank_connection",
    description: `Change the nickname of a bank connection. At most 100 characters; a blank nickname uses the bank's own name; an unchanged nickname writes nothing. No secret (no access token) is returned. ${MONEY} Returns { bank_connection } as get_bank_connection does, with the new nickname. ${timestamps(["last_synced_at", "last_reset_at", "sync_failed_at", "created_at", "balance_updated_at"], ["last_synced_at", "last_reset_at", "sync_failed_at", "balance_updated_at"])}`,
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
  {
    name: "sync_bank_connections",
    description: `Sync with the bank now (this contacts the bank through Plaid). It imports new posted transactions into the plan's linked accounts as unapproved transactions, matches them to transactions entered by hand, and may add, change and delete unapproved transactions (an approved, edited or rejected transaction is never changed or brought back; a reconciled one is never changed). ${MONEY} Plaid's own sign is the opposite and is converted: an import's amount is negative for money leaving the account. With bank_connection_id: one connection; without: every connection linked to an account of the plan, in turn. Safe to run again. Returns the sync result { bank_connection_id, status, added, matched, modified, removed, skipped, has_more, last_synced_at }; without bank_connection_id Returns { results }, one such result per connection. status is connected, delayed (the bank did not answer, or the sync failed in Budget: try later), login_required or broken (the connection needs the owner in the app) or not_set_up. has_more true means there is more to read: call again. ${timestamps(["last_synced_at"], ["last_synced_at"])}`,
    inputSchema: z.object({ budget_id: Id, bank_connection_id: Id.optional() }),
    run: async (input: { budget_id: string; bank_connection_id?: string }, { env }) =>
      input.bank_connection_id
        ? syncBankConnection(env, input.budget_id, input.bank_connection_id)
        : syncPlan(env, input.budget_id),
  },
];
