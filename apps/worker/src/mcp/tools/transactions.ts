import { IsoDate } from "@budget/schema/common/dates";
import {
  PlainClearedStatus,
  TransactionCreateRequest,
  type TransactionUpdateRequest,
  transactionUpdateShape,
} from "@budget/schema/transactions";
import { z } from "zod";
import {
  addTransaction,
  deleteTransaction,
  getAccountBalances,
  getTransaction,
  listAccountTransactions,
  listPlanTransactions,
  updateTransaction,
} from "../../services/transactions";
import { DATE, Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

type Create = z.input<typeof TransactionCreateRequest>;
type Update = z.input<typeof TransactionUpdateRequest>;

export const tools: McpToolDef[] = [
  {
    name: "list_transactions",
    description: `List a plan's transactions with balances. With account_id: that account's rows and balances. Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts. Newest first, same-date by amount ascending. ${MONEY} ${DATE} since_date limits the rows, not the balances. Returns { transactions, balances: { cleared, uncleared, working } }; each row has id, account_id, date, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign and updated_at.`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id.optional(),
      since_date: IsoDate.optional(),
    }),
    run: async (input: { budget_id: string; account_id?: string; since_date?: string }, { env }) =>
      input.account_id
        ? listAccountTransactions(env, input.budget_id, input.account_id, {
            sinceDate: input.since_date,
          })
        : listPlanTransactions(env, input.budget_id, { sinceDate: input.since_date }),
  },
  {
    name: "get_account_balances",
    description: `An account's cleared, uncleared and working (cleared + uncleared) balances. ${MONEY} Returns { cleared, uncleared, working }.`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env }) =>
      getAccountBalances(env, input.budget_id, input.account_id),
  },
  {
    name: "get_transaction",
    description: `Read one transaction of a plan. ${MONEY} ${DATE} Returns { transaction } with id, account_id, date, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign and updated_at. A deleted transaction, or one of another plan, is a tool error (not found).`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env }) => ({
      transaction: await getTransaction(env, input.budget_id, input.transaction_id),
    }),
  },
  {
    name: "create_transaction",
    description: `Add a transaction to an account. ${MONEY} ${DATE} cleared is uncleared (default) or cleared; approved defaults to true. Give a category_id or inflow_to_ready_to_assign: true, never both; a tracking account takes neither; the category must be in the plan (otherwise a tool error). Give payee_id (from list_payees) or payee_name, never both: a payee_name that exactly matches an existing payee uses it, otherwise a payee is created with the transaction. Returns { transaction } with id, account_id, date, payee_id, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved and updated_at.`,
    inputSchema: z.object({
      budget_id: Id,
      ...TransactionCreateRequest.shape,
      cleared: PlainClearedStatus.optional(),
    }),
    run: async (input: { budget_id: string } & Create, { env, actor }) => {
      const { budget_id, ...rest } = input;
      return { transaction: await addTransaction(env, actor, budget_id, rest) };
    },
  },
  {
    name: "update_transaction",
    description: `Change fields of a transaction; send only what changes. ${MONEY} ${DATE} cleared is uncleared or cleared. category_id and inflow_to_ready_to_assign follow the create_transaction rules, and so do payee_id and payee_name (null clears the payee). A reconciled transaction, and a credit account's Starting Balance payee, category and account, cannot be changed (tool error). Returns { transaction } with the same fields as get_transaction.`,
    inputSchema: z.object({
      budget_id: Id,
      transaction_id: Id,
      ...transactionUpdateShape,
      cleared: PlainClearedStatus.optional(),
    }),
    run: async (input: { budget_id: string; transaction_id: string } & Update, { env, actor }) => {
      const { budget_id, transaction_id, ...rest } = input;
      return { transaction: await updateTransaction(env, actor, budget_id, transaction_id, rest) };
    },
  },
  {
    name: "delete_transaction",
    description: `Delete a transaction (soft delete): it leaves the register, the balances and the month figures. A reconciled transaction cannot be deleted (tool error). ${MONEY} Returns { transaction }: the transaction as it was, with its amount.`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) => ({
      transaction: await deleteTransaction(env, actor, input.budget_id, input.transaction_id),
    }),
  },
];
