import { IsoDate } from "@budget/schema/common/dates";
import { Milliunits } from "@budget/schema/common/money";
import {
  PlainClearedStatus,
  TransactionCreateRequest,
  type TransactionUpdateRequest,
  transactionUpdateShape,
} from "@budget/schema/transactions";
import { z } from "zod";
import {
  addTransaction,
  createTransfer,
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
    description: `List a plan's transactions with balances. With account_id: that account's rows and balances. Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts. Newest first, same-date by amount ascending. ${MONEY} ${DATE} since_date limits the rows, not the balances. Returns { transactions, balances: { cleared, uncleared, working } }; each row has id, account_id, date, payee_id, payee_name, payee_system (starting_balance for an account's opening balance, otherwise null), category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign, transfer_account_id and transfer_transaction_id (the other side of a transfer, else null), transfer_account_name, subtransactions (the lines of a split, else []) and updated_at.`,
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
    description: `Read one transaction of a plan. ${MONEY} ${DATE} Returns { transaction } with id, account_id, date, payee_id, payee_name, payee_system (starting_balance for an account's opening balance, otherwise null), category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign, transfer_account_id and transfer_transaction_id (the other side of a transfer, else null), transfer_account_name and subtransactions (the lines of a split, else []) and updated_at. A deleted transaction, or one of another plan, is a tool error (not found).`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env }) => ({
      transaction: await getTransaction(env, input.budget_id, input.transaction_id),
    }),
  },
  {
    name: "create_transaction",
    description: `Add a transaction to an account. ${MONEY} ${DATE} cleared is uncleared (default) or cleared; approved defaults to true. Give a category_id or inflow_to_ready_to_assign: true, never both; a tracking account takes neither; the category must be in the plan (otherwise a tool error). Give payee_id (from list_payees) or payee_name, never both: a payee_name that exactly matches an existing payee uses it, otherwise a payee is created with the transaction. transfer_account_id makes it a transfer: the server also creates the other account's row (opposite amount, same date and memo, uncleared), and a transfer between two on-plan accounts takes no category. subtransactions makes it a split: two or more lines whose amounts add up to amount; each line has its own category, payee and memo and the transaction itself has no category. Returns { transaction } with id, account_id, date, payee_id, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, transfer_account_id, transfer_transaction_id, subtransactions and updated_at.`,
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
    name: "create_transfer",
    description: `Move money between two accounts of a plan: creates the paired transactions in one step. amount is the positive amount moved; from_account_id gets -amount and to_account_id +amount, same date and memo, and each side has its own cleared state (cleared applies to the from side, the other side starts uncleared). category_id is only for a transfer between an on-plan and a tracking account and goes to the on-plan side; a transfer between two on-plan accounts takes no category. ${MONEY} ${DATE} Returns { from_transaction, to_transaction }, each with id, account_id, amount, transfer_account_id and transfer_transaction_id.`,
    inputSchema: z.object({
      budget_id: Id,
      from_account_id: Id,
      to_account_id: Id,
      amount: Milliunits,
      date: IsoDate,
      memo: z.string().max(500).optional(),
      category_id: Id.optional(),
      cleared: PlainClearedStatus.optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        from_account_id: string;
        to_account_id: string;
        amount: number;
        date: string;
        memo?: string;
        category_id?: string;
        cleared?: "uncleared" | "cleared";
      },
      { env, actor },
    ) => {
      const { budget_id, ...rest } = input;
      return createTransfer(env, actor, budget_id, rest);
    },
  },
  {
    name: "update_transaction",
    description: `Change fields of a transaction; send only what changes. ${MONEY} ${DATE} cleared is uncleared or cleared. category_id and inflow_to_ready_to_assign follow the create_transaction rules, and so do payee_id and payee_name (null clears the payee). transfer_account_id sets or changes the other account of a transfer (null makes it a plain transaction again); amount, date and memo of a transfer are mirrored to its other side. subtransactions replaces the lines of a split (an empty list makes it a plain transaction); send amount with it when the total changes. A reconciled transaction (or a transfer whose other side is reconciled), and a credit account's Starting Balance payee, category and account, cannot be changed (tool error). Returns { transaction } with the same fields as get_transaction.`,
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
    description: `Delete a transaction (soft delete): it leaves the register, the balances and the month figures. Deleting either side of a transfer deletes both, and deleting a split deletes its lines. A reconciled transaction (or a transfer whose other side is reconciled) cannot be deleted (tool error). ${MONEY} Returns { transaction }: the transaction as it was, with its amount.`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) => ({
      transaction: await deleteTransaction(env, actor, input.budget_id, input.transaction_id),
    }),
  },
];
