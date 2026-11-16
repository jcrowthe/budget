import { IsoDate } from "@budget/schema/common/dates";
import {
  TransactionCreateRequest,
  type TransactionUpdateRequest,
  transactionUpdateShape,
} from "@budget/schema/transactions";
import { z } from "zod";
import {
  addTransaction,
  deleteTransaction,
  getAccountBalances,
  listAccountTransactions,
  listPlanTransactions,
  updateTransaction,
} from "../../services/transactions";
import type { McpToolDef } from "../types";

const id = z.string().min(1);
const money =
  "Amounts are integer milliunits (1000 = one currency unit); negative is an outflow, positive an inflow.";
const rules =
  "Refused with 422 when the category is not in the plan, a category and the Ready to Assign flag are both set, a tracking account gets either, or cleared is 'reconciled'.";
const locked =
  "A reconciled transaction, and a credit account's Starting Balance payee, category and account, cannot be changed (409).";

type Create = z.input<typeof TransactionCreateRequest>;
type Update = z.input<typeof TransactionUpdateRequest>;

export const tools: McpToolDef[] = [
  {
    name: "list_transactions",
    description: `List an account's transactions (newest first, same-date by amount ascending) with its balances {cleared, uncleared, working}. ${money} since_date (YYYY-MM-DD) limits the rows, not the balances. Each row has category_name and category_group_name. Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts.`,
    inputSchema: z.object({
      budget_id: id,
      account_id: id.optional(),
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
    description: `An account's cleared, uncleared and working (cleared + uncleared) balances. ${money}`,
    inputSchema: z.object({ budget_id: id, account_id: id }),
    run: async (input: { budget_id: string; account_id: string }, { env }) =>
      getAccountBalances(env, input.budget_id, input.account_id),
  },
  {
    name: "create_transaction",
    description: `Add a transaction to an account. ${money} cleared is 'uncleared' (default) or 'cleared'; approved defaults to true. Give a category_id or inflow_to_ready_to_assign, never both. ${rules}`,
    inputSchema: z.object({ budget_id: id, ...TransactionCreateRequest.shape }),
    run: async (input: { budget_id: string } & Create, { env, actor }) => {
      const { budget_id, ...rest } = input;
      return { transaction: await addTransaction(env, actor, budget_id, rest) };
    },
  },
  {
    name: "update_transaction",
    description: `Change fields of a transaction; send only what changes. ${money} ${rules} ${locked}`,
    inputSchema: z.object({
      budget_id: id,
      transaction_id: id,
      ...transactionUpdateShape,
    }),
    run: async (input: { budget_id: string; transaction_id: string } & Update, { env, actor }) => {
      const { budget_id, transaction_id, ...rest } = input;
      return { transaction: await updateTransaction(env, actor, budget_id, transaction_id, rest) };
    },
  },
  {
    name: "delete_transaction",
    description: `Delete a transaction (soft delete); it leaves the register, the balances and the month figures. Returns the transaction as it was. ${locked}`,
    inputSchema: z.object({ budget_id: id, transaction_id: id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) => ({
      transaction: await deleteTransaction(env, actor, input.budget_id, input.transaction_id),
    }),
  },
];
