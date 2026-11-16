import { AccountCreateRequest, accountUpdateShape } from "@budget/schema/accounts";
import { z } from "zod";
import {
  addUnlinkedAccount,
  getAccount,
  getAccountSummary,
  listAccounts,
  updateAccount,
} from "../../services/accounts";
import { DATE, Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_accounts",
    description: `List a plan's accounts in display order; closed accounts only when include_closed is true. ${MONEY} Debts are negative. Returns { accounts }: each with id, name, type, on_budget, starred, closed, group (cash, credit, loans, tracking or closed), cleared_balance, uncleared_balance and balance.`,
    inputSchema: z.object({ budget_id: Id, include_closed: z.boolean().optional() }),
    run: async (input: { budget_id: string; include_closed?: boolean }, { env }) => ({
      accounts: await listAccounts(env, input.budget_id, { includeClosed: input.include_closed }),
    }),
  },
  {
    name: "get_account",
    description: `Read one account of a plan. ${MONEY} Debts are negative. Returns { account } with id, name, type, on_budget, starred, closed, group, cleared_balance, uncleared_balance and balance.`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env }) => ({
      account: await getAccount(env, input.budget_id, input.account_id),
    }),
  },
  {
    name: "update_account",
    description: `Change an account; send only what changes. starred adds it to or removes it from the sidebar's STARRED group; a closed account cannot be starred (tool error). ${MONEY} Returns { account } with id, name, type, starred, closed, group, cleared_balance, uncleared_balance and balance.`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id,
      ...accountUpdateShape,
    }),
    run: async (
      input: { budget_id: string; account_id: string; starred?: boolean },
      { env, actor },
    ) => {
      const { budget_id, account_id, ...patch } = input;
      return { account: await updateAccount(env, actor, budget_id, account_id, patch) };
    },
  },
  {
    name: "create_account",
    description: `Add an unlinked account with a Starting Balance transaction. ${MONEY} balance is entered as shown: for credit cards, lines of credit and other liabilities a positive number means money owed and is stored negative. Loan types are not supported yet. ${DATE} date defaults to today (UTC). Returns { account, starting_balance }: the new account with its balances, and the Starting Balance transaction.`,
    inputSchema: z.object({ budget_id: Id, ...AccountCreateRequest.shape }),
    run: async (
      input: { budget_id: string } & z.input<typeof AccountCreateRequest>,
      { env, actor },
    ) => {
      const { budget_id, ...rest } = input;
      return addUnlinkedAccount(env, actor, budget_id, rest);
    },
  },
  {
    name: "get_account_summary",
    description: `The cleared, uncleared and working (cleared + uncleared) totals over every open account of a plan. ${MONEY} Returns { balances: { cleared, uncleared, working } }.`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      balances: await getAccountSummary(env, input.budget_id),
    }),
  },
];
