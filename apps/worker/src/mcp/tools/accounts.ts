import {
  AccountCreateRequest,
  type AccountLinkRequest,
  type AccountsFromBankRequest,
  accountLinkFields,
  accountsFromBankFields,
  accountUpdateShape,
} from "@budget/schema/accounts";
import { z } from "zod";
import { createAccountsFromBank, linkAccount, unlinkAccount } from "../../services/account-links";
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
    description: `List a plan's accounts in display order; closed accounts only when include_closed is true. ${MONEY} Debts are negative. Returns { accounts }: each with id, name, type, on_budget, starred, closed, group (cash, credit, loans, tracking or closed), cleared_balance, uncleared_balance and balance, plus bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked).`,
    inputSchema: z.object({ budget_id: Id, include_closed: z.boolean().optional() }),
    run: async (input: { budget_id: string; include_closed?: boolean }, { env }) => ({
      accounts: await listAccounts(env, input.budget_id, { includeClosed: input.include_closed }),
    }),
  },
  {
    name: "get_account",
    description: `Read one account of a plan. ${MONEY} Debts are negative. Returns { account } with id, name, type, on_budget, starred, closed, group, cleared_balance, uncleared_balance and balance, plus bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked).`,
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
    name: "create_accounts_from_bank",
    description: `Add bank accounts of a connection as new linked accounts of a plan. Each gets a Starting Balance transaction (cleared, approved) dated today equal to the bank's current balance; ${MONEY} What is owed on a credit card or loan is negative; no balance from the bank gives 0. The account type follows the bank account's type (checking, savings, creditCard, a loan type, otherwise otherAsset); overrides, keyed by bank_account_id, may set a name and any type but cash. Cash accounts are refused (tool error). A bank account already linked in this plan, or a name already used, is an error and nothing is created. A bank account of a connection in another environment than the plan's is not found. ${DATE} today is the link date and defaults to the UTC date. Returns { created: [{ account, starting_balance }] } in the order of bank_account_ids; each account has linked true, bank_account_id and import_start_date.`,
    inputSchema: z.object({ budget_id: Id, ...accountsFromBankFields }),
    run: async (input: { budget_id: string } & AccountsFromBankRequest, { env, actor }) => {
      const { budget_id, ...rest } = input;
      return createAccountsFromBank(env, actor, budget_id, rest);
    },
  },
  {
    name: "link_account",
    description: `Link an existing unlinked account of a plan to a bank account. Cash and closed accounts are refused (tool error); an account or bank account that is already linked is an error; a bank account of another environment than the plan's is not found. import_start_date becomes 3 days before the account's latest reconciled transaction, or today when none. No transaction changes. ${DATE} today is the link date and defaults to the UTC date. Returns { account } with linked true, bank_account_id and import_start_date. ${MONEY}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id, ...accountLinkFields }),
    run: async (
      input: { budget_id: string; account_id: string } & AccountLinkRequest,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...rest } = input;
      return { account: await linkAccount(env, actor, budget_id, account_id, rest) };
    },
  },
  {
    name: "unlink_account",
    description: `Unlink an account from its bank account. Every transaction and the bank connection stay, and the bank account can be linked again. An account that is not linked is returned unchanged. ${MONEY} Returns { account } with linked false and bank_account_id and import_start_date null.`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env, actor }) => ({
      account: await unlinkAccount(env, actor, input.budget_id, input.account_id),
    }),
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
