import {
  type AccountAdjustBalanceRequest,
  type AccountCloseRequest,
  type AccountCreateRequest as AccountCreateRequestInput,
  type AccountLinkRequest,
  type AccountsFromBankRequest,
  accountAdjustFields,
  accountCloseFields,
  accountCreateFields,
  accountLinkFields,
  accountsFromBankFields,
  accountUpdateShape,
} from "@budget/schema/accounts";
import { z } from "zod";
import { createAccountsFromBank, linkAccount, unlinkAccount } from "../../services/account-links";
import { reorderAccounts } from "../../services/account-order";
import {
  addUnlinkedAccount,
  adjustBalance,
  closeAccount,
  deleteAccount,
  getAccount,
  getAccountSummary,
  listAccounts,
  reopenAccount,
  updateAccount,
} from "../../services/accounts";
import { dates, Id, LINK_STATE, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_accounts",
    description: `List a plan's accounts in display order; closed accounts only when include_closed is true. ${MONEY} Debts are negative. Returns { accounts }: each with id, name, type, on_budget, starred, closed, group (cash, credit, loans, tracking or closed), cleared_balance, uncleared_balance and balance, plus bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked), unapproved_count (transactions to approve) and needs_attention_count (unapproved or needing a category), plus interest_rate, minimum_payment, escrow_amount and paired_category_id (loan accounts only, null otherwise). Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, include_closed: z.boolean().optional() }),
    run: async (input: { budget_id: string; include_closed?: boolean }, { env }) => ({
      accounts: await listAccounts(env, input.budget_id, { includeClosed: input.include_closed }),
    }),
  },
  {
    name: "reorder_accounts",
    description: `Put one sidebar group's open accounts in a new order. account_ids are the accounts in their new order, all from one group (cash, credit, loans or tracking): the accounts trade the places they held, and accounts you leave out keep theirs, so a subset (for example the starred accounts of one group) reorders only those. A closed account (account_closed), ids from more than one group (account_groups_mixed) and repeated ids are tool errors, and an unknown id is not found; nothing is written. An order that is already the order changes nothing. ${MONEY} Debts are negative. Returns { accounts }: every account of the plan, closed ones included, in display order, each with id, name, type, on_budget, starred, closed, group (cash, credit, loans, tracking or closed), cleared_balance, uncleared_balance and balance, plus bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked), unapproved_count and needs_attention_count, plus interest_rate, minimum_payment, escrow_amount and paired_category_id (loan accounts only, null otherwise). Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_ids: z.array(Id).min(1).max(500) }),
    run: async (input: { budget_id: string; account_ids: string[] }, { env, actor }) => ({
      accounts: await reorderAccounts(env, actor, input),
    }),
  },
  {
    name: "get_account",
    description: `Read one account of a plan. ${MONEY} Debts are negative. Returns { account } with id, name, type, on_budget, starred, closed, group, cleared_balance, uncleared_balance and balance, plus bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked), unapproved_count (transactions to approve) and needs_attention_count (unapproved or needing a category), plus interest_rate, minimum_payment, escrow_amount and paired_category_id (loan accounts only, null otherwise). Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env }) => ({
      account: await getAccount(env, input.budget_id, input.account_id),
    }),
  },
  {
    name: "update_account",
    description: `Change an account; send only what changes. name must be unique among the plan's accounts ignoring case (a blank or taken name is a tool error); note is free text up to 500 characters (null or blank clears it); starred adds it to or removes it from the sidebar's STARRED group, and a closed account cannot be starred (tool error). ${MONEY} Returns { account } with id, name, note, type, starred, closed, group, cleared_balance, uncleared_balance, balance and can_delete. Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])} Renaming a credit account renames its payment category.`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id,
      ...accountUpdateShape,
    }),
    run: async (
      input: {
        budget_id: string;
        account_id: string;
        name?: string;
        note?: string | null;
        starred?: boolean;
      },
      { env, actor },
    ) => {
      const { budget_id, account_id, ...patch } = input;
      return { account: await updateAccount(env, actor, budget_id, account_id, patch) };
    },
  },
  {
    name: "adjust_account_balance",
    description: `Set an open account's working balance by adding a cleared, approved "Manual Balance Adjustment" transaction for the difference. On-plan accounts (checking, savings, cash, creditCard, lineOfCredit) send it to Ready to Assign, so Ready to Assign changes by the same amount; tracking and loan accounts take no category and leave Ready to Assign unchanged. balance is the signed working balance (debts negative). No difference means no transaction. A closed account is refused (tool error). ${MONEY} ${dates("today", "date")} today is the adjustment's date and defaults to the UTC date. Returns { account, adjustment }: the account with its new balances, and the transaction (null when nothing changed). Each account also has ${LINK_STATE}. ${timestamps(["created_at", "updated_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id, ...accountAdjustFields }),
    run: async (
      input: { budget_id: string; account_id: string } & AccountAdjustBalanceRequest,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...rest } = input;
      return adjustBalance(env, actor, budget_id, account_id, rest);
    },
  },
  {
    name: "close_account",
    description: `Close an account. A non-zero balance is first zeroed by a cleared "Manual Balance Adjustment" with memo "Closed Account" (on-plan accounts send it to Ready to Assign, tracking and loan accounts take no category). The account is also unstarred and, when linked, unlinked from its bank account. A closed account is returned unchanged. ${MONEY} ${dates("today", "date")} today is the adjustment's date and defaults to the UTC date. Returns { account, adjustment } (adjustment null when the balance was zero). Each account also has ${LINK_STATE}. ${timestamps(["created_at", "updated_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id, ...accountCloseFields }),
    run: async (
      input: { budget_id: string; account_id: string } & AccountCloseRequest,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...rest } = input;
      return closeAccount(env, actor, budget_id, account_id, rest);
    },
  },
  {
    name: "reopen_account",
    description: `Re-open a closed account. The closing adjustment stays and the star is not restored; an open account is returned unchanged. ${MONEY} Returns { account } with id, name, closed, group, cleared_balance, uncleared_balance, balance and can_delete. Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env, actor }) => ({
      account: await reopenAccount(env, actor, input.budget_id, input.account_id),
    }),
  },
  {
    name: "delete_account",
    description: `Delete an account and its Starting Balance transaction (both soft-deleted; Ready to Assign follows). Refused with a tool error when the account has any other transaction, or, for a closed account, any transaction at all: close it instead to keep its history. A linked account is unlinked. Returns { account_id, deleted_transaction_ids }. ${MONEY} Deleting a credit account removes its payment category, refused (409) while that category has assigned money or transactions.`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env, actor }) =>
      deleteAccount(env, actor, input.budget_id, input.account_id),
  },
  {
    name: "create_account",
    description: `Add an unlinked account with a Starting Balance transaction. ${MONEY} balance is entered as shown: for credit cards, lines of credit and other liabilities a positive number means money owed and is stored negative. Loan types (mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt) are recorded as off-plan debts and require interest_rate (a decimal string, 0 to 100, e.g. "6.5") and minimum_payment (the monthly payment the lender requires, in milliunits); they accept escrow_amount (milliunits, stored 0 when absent) and at most one pairing: paired_category_id (an existing category) or new_category { name, group_id | new_group_name } (creates the category, and the group when new_group_name is given, with the account). Those fields on any other type, a bad rate, both pairings, an unusable or hidden category or group, or a name already used are a tool error and nothing is created. The values are only recorded. ${dates("date")} date defaults to today (UTC). Returns { account, starting_balance }: the new account with its balances and interest_rate, minimum_payment, escrow_amount and paired_category_id (null on other types), and the Starting Balance transaction. Each account also has ${LINK_STATE}. ${timestamps(["created_at", "updated_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])} A Credit Card or Line of Credit also gets a payment category named like the account in the Credit Card Payments group.`,
    inputSchema: z.object({ budget_id: Id, ...accountCreateFields }),
    run: async (input: { budget_id: string } & AccountCreateRequestInput, { env, actor }) => {
      const { budget_id, ...rest } = input;
      return addUnlinkedAccount(env, actor, budget_id, rest);
    },
  },
  {
    name: "create_accounts_from_bank",
    description: `Add bank accounts of a connection as new linked accounts of a plan. Each gets a Starting Balance transaction (cleared, approved) dated today equal to the bank's current balance; ${MONEY} What is owed on a credit card or loan is negative; no balance from the bank gives 0. The account type follows the bank account's type (checking, savings, creditCard, a loan type, otherwise otherAsset); overrides, keyed by bank_account_id, may set a name and any type but cash. Cash accounts are refused (tool error). A bank account already linked in this plan, or a name already used, is an error and nothing is created. A bank account of a connection in another environment than the plan's is not found. ${dates("today", "import_start_date")} today is the link date and defaults to the UTC date; today also sets import_start_date: only the bank's transactions dated on or after it are imported. Returns { created: [{ account, starting_balance }] } in the order of bank_account_ids; each account has linked true, bank_account_id and import_start_date. Each account also has ${LINK_STATE}. ${timestamps(["created_at", "updated_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])} A Credit Card or Line of Credit also gets a payment category named like the account in the Credit Card Payments group.`,
    inputSchema: z.object({ budget_id: Id, ...accountsFromBankFields }),
    run: async (input: { budget_id: string } & AccountsFromBankRequest, { env, actor }) => {
      const { budget_id, ...rest } = input;
      return createAccountsFromBank(env, actor, budget_id, rest);
    },
  },
  {
    name: "link_account",
    description: `Link an existing unlinked account of a plan to a bank account. Cash and closed accounts are refused (tool error); a bank account that is already linked is an error, and so is an account that is already linked, unless its link_missing_since is set (Linked Account Not Found): that account may be linked to another bank account without unlinking first, which replaces the link; a bank account of another environment than the plan's is not found. import_start_date becomes 3 days before the account's latest reconciled transaction, or today when none. No transaction changes. ${dates("today", "import_start_date")} today is the link date and defaults to the UTC date. Returns { account } with linked true, bank_account_id and import_start_date. ${MONEY} Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
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
    description: `Unlink an account from its bank account. Every transaction and the bank connection stay, and the bank account can be linked again. An account that is not linked is returned unchanged. ${MONEY} Returns { account } with linked false and bank_account_id and import_start_date null. Each account also has ${LINK_STATE}. ${timestamps(["created_at", "last_reconciled_at", "last_synced_at", "link_missing_since"], ["last_reconciled_at", "last_synced_at", "link_missing_since"])}`,
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
