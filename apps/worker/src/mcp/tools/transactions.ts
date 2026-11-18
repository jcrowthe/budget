import { IsoDate } from "@budget/schema/common/dates";
import { Milliunits } from "@budget/schema/common/money";
import {
  FlagColor,
  PlainClearedStatus,
  type TransactionBulkRequest,
  TransactionCreateRequest,
  type TransactionUpdateRequest,
  transactionUpdateShape,
} from "@budget/schema/transactions";
import { z } from "zod";
import { matchTransactions, unmatchTransaction } from "../../services/manual-match";
import {
  addTransaction,
  approveTransactions,
  createTransfer,
  deleteTransaction,
  getAccountBalances,
  getTransaction,
  listAccountTransactions,
  listPlanTransactions,
  rejectTransactions,
  updateTransaction,
} from "../../services/transactions";
import { bulkTransactions } from "../../services/transactions-bulk";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

type Create = z.input<typeof TransactionCreateRequest>;
type Update = z.input<typeof TransactionUpdateRequest>;

export const tools: McpToolDef[] = [
  {
    name: "list_transactions",
    description: `List a plan's transactions with balances. With account_id: that account's rows and balances. Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts. Newest first, same-date by amount ascending. ${MONEY} since_date limits the rows, not the balances. With account_id and include "running_balance", each row also has running_balance: the account's balance after that row, adding oldest first (same-date rows by amount descending), counting every earlier row of the account, also those since_date leaves out; scheduled transactions have none. Returns { transactions, balances: { cleared, uncleared, working } }; each row has id, account_id, date, payee_id, payee_name, payee_system (starting_balance for an account's opening balance, otherwise null), category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign, transfer_account_id and transfer_transaction_id (the other side of a transfer, else null), transfer_account_name, subtransactions (the lines of a split, else []), flag_color (red, orange, yellow, green, blue, purple, or null), import_id, source (plaid for an imported transaction, null when entered by hand), imported_payee, bank_description and matched (true when an import was matched to a transaction entered by hand), match_details (for a matched transaction the bank's date, amount and payee_name as imported, else null), and updated_at. ${dates("date", "since_date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id.optional(),
      since_date: IsoDate.optional(),
      include: z.enum(["running_balance"]).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        account_id?: string;
        since_date?: string;
        include?: "running_balance";
      },
      { env },
    ) => {
      if (!input.account_id && input.include) throw new Error("running_balance needs account_id");
      return input.account_id
        ? listAccountTransactions(env, input.budget_id, input.account_id, {
            sinceDate: input.since_date,
            include: input.include,
          })
        : listPlanTransactions(env, input.budget_id, { sinceDate: input.since_date });
    },
  },
  {
    name: "list_unapproved_transactions",
    description: `List the transactions that need you: the unapproved ones (imports from the bank to review) and those that need a category (an on-plan account, no category, not Ready to Assign, not a split or an on-plan transfer or a Starting Balance). With account_id: that account's rows; without: every account's rows with account_name. ${MONEY} Returns { transactions, balances: { cleared, uncleared, working } }; each row has the fields of list_transactions, including approved, flag_color (red, orange, yellow, green, blue, purple, or null), import_id, source (plaid for an import), imported_payee, bank_description and matched. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id.optional() }),
    run: async (input: { budget_id: string; account_id?: string }, { env }) =>
      input.account_id
        ? listAccountTransactions(env, input.budget_id, input.account_id, {
            needs: "approval_or_category",
          })
        : listPlanTransactions(env, input.budget_id, { needs: "approval_or_category" }),
  },
  {
    name: "approve_transactions",
    description: `Approve 1 to 100 transactions (the ids from list_unapproved_transactions): each row, its split lines and the other side of a transfer become approved. An approved transaction is returned as it is and nothing is written. An unknown id is a tool error and nothing is approved. ${MONEY} Returns { transactions }: the transactions after approval, in the order given, each as get_transaction returns it. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, ids: z.array(Id).min(1).max(100) }),
    run: async (input: { budget_id: string; ids: string[] }, { env, actor }) => ({
      transactions: await approveTransactions(env, actor, input.budget_id, input.ids),
    }),
  },
  {
    name: "reject_transactions",
    description: `Reject 1 to 100 imported transactions that are not approved yet: each is deleted and the bank's entry is never imported again (a later sync does not bring it back). Only an unapproved import can be rejected: an approved transaction is a tool error (transaction_approved) and so is one that did not come from the bank (not_imported); an unknown id is a tool error; every id is checked before anything is written, so these errors reject nothing (only a transaction changed by someone else during the write itself can fail the call after others were rejected: list again). ${MONEY} Returns { transactions }: the rejected transactions as they were, in the order given, each as get_transaction returns it. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, ids: z.array(Id).min(1).max(100) }),
    run: async (input: { budget_id: string; ids: string[] }, { env, actor }) => ({
      transactions: await rejectTransactions(env, actor, input.budget_id, input.ids),
    }),
  },
  {
    name: "match_transactions",
    description: `Match an unapproved bank import to a transaction entered by hand, as one transaction (ids: exactly two transactions of one open account, one the import and one the hand entry). The hand entry keeps its payee, memo, date, category and flag, and takes the bank's amount, the import's id and bank fields (imported_payee, bank_description and the bank's date, amount and payee, shown as match_details), cleared (a reconciled entry stays reconciled) and approved; the import's own row is deleted. Dates may be any distance apart and amounts may differ: only this tool, the owner's word, matches such rows; the bank sync matches only equal amounts within 10 days. Refused as a tool error, with nothing written: rows of two accounts, a closed account, a row already matched (not_matchable), two imports or two hand entries, an approved, split or transfer import, a split or transfer entry whose amount differs from the bank's (not_matchable), a reconciled import or a reconciled entry whose amount would change (transaction_reconciled); an unknown id is not found. ${MONEY} Returns { transaction, removed }: the matched transaction and the import's row as it was, each as get_transaction returns it. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, ids: z.array(Id).length(2) }),
    run: async (input: { budget_id: string; ids: string[] }, { env, actor }) =>
      matchTransactions(env, actor, input.budget_id, input.ids),
  },
  {
    name: "unmatch_transaction",
    description: `Undo a match: the matched transaction becomes two again. The hand entry comes back with its amount from before the match (for a split or a transfer, the present amount), uncleared, with its own payee, memo, date, category and flag, and no import id. The import comes back as a new unapproved transaction with the bank's date, amount and payee and the same import id, which no later sync matches or imports again; it has no category, memo or flag. Refused as a tool error, with nothing written: a transaction that is not matched or has no record of the bank's transaction (not_matched), a closed account (account_closed), a reconciled transaction (transaction_reconciled); an unknown id is not found. ${MONEY} Returns { transaction, imported }, each as get_transaction returns it. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) =>
      unmatchTransaction(env, actor, input.budget_id, input.transaction_id),
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
    description: `Read one transaction of a plan. ${MONEY} ${dates("date")} Returns { transaction } with id, account_id, date, payee_id, payee_name, payee_system (starting_balance for an account's opening balance, otherwise null), category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign, transfer_account_id and transfer_transaction_id (the other side of a transfer, else null), transfer_account_name and subtransactions (the lines of a split, else []), flag_color (red, orange, yellow, green, blue, purple, or null), import_id, source (plaid for an imported transaction, null when entered by hand), imported_payee, bank_description and matched (true when an import was matched to a transaction entered by hand), and updated_at. A deleted transaction, or one of another plan, is a tool error (not found). ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env }) => ({
      transaction: await getTransaction(env, input.budget_id, input.transaction_id),
    }),
  },
  {
    name: "create_transaction",
    description: `Add a transaction to an account. ${MONEY} ${dates("date")} cleared is uncleared (default) or cleared; approved defaults to true. Give a category_id or inflow_to_ready_to_assign: true, never both; a tracking account takes neither; the category must be in the plan (otherwise a tool error). Give payee_id (from list_payees) or payee_name, never both: a payee_name that exactly matches an existing payee uses it, otherwise a payee is created with the transaction. transfer_account_id makes it a transfer: the server also creates the other account's row (opposite amount, same date and memo, uncleared), and a transfer between two on-plan accounts takes no category. subtransactions makes it a split: two or more lines whose amounts add up to amount; each line has its own category, payee and memo and the transaction itself has no category. Returns { transaction } with id, account_id, date, payee_id, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, transfer_account_id, transfer_transaction_id, subtransactions and updated_at. A closed account takes no new transaction: creating one on it, or a transfer to it, is a tool error (account_closed). ${timestamps(["updated_at", "created_at"])}`,
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
    description: `Move money between two accounts of a plan: creates the paired transactions in one step. amount is the positive amount moved; from_account_id gets -amount and to_account_id +amount, same date and memo, and each side has its own cleared state (cleared applies to the from side, the other side starts uncleared). category_id is only for a transfer between an on-plan and a tracking account and goes to the on-plan side; a transfer between two on-plan accounts takes no category. ${MONEY} Returns { from_transaction, to_transaction }, each with id, account_id, amount, transfer_account_id and transfer_transaction_id. ${dates("date") + " " + timestamps(["updated_at", "created_at"])}`,
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
    description: `Change fields of a transaction; send only what changes. flag_color (red, orange, yellow, green, blue, purple, or null to clear) sets the flag: sent alone it neither approves the transaction nor is refused for a reconciled one. ${MONEY} ${dates("date")} cleared is uncleared or cleared. category_id and inflow_to_ready_to_assign follow the create_transaction rules, and so do payee_id and payee_name (null clears the payee). transfer_account_id sets or changes the other account of a transfer (null makes it a plain transaction again); amount, date and memo of a transfer are mirrored to its other side. subtransactions replaces the lines of a split (an empty list makes it a plain transaction); send amount with it when the total changes. Saving a change to an unapproved transaction approves it (unless approved: false is sent). Changing the amount, date, account, cleared state or transfer account of a reconciled transaction (or of a transfer whose other side is reconciled) is a tool error unless confirm_reconciled is true (the memo, payee, category, flag and approval save without it; an edit keeps the row reconciled unless cleared is sent). A credit account's Starting Balance payee, category and account cannot be changed (tool error). Moving a linked account's Starting Balance to an earlier date moves the account's import_start_date with it, which widens the import: the next sync brings the bank's transactions from that date. Returns { transaction } with the same fields as get_transaction. Both accounts must be open: a closed from or to account is a tool error (account_closed). A transaction of a closed account can still be changed or deleted, but moving a transaction into a closed account, or a new transfer to one, is a tool error (account_closed). ${timestamps(["updated_at", "created_at"])}`,
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
    description: `Delete a transaction (soft delete): it leaves the register, the balances and the month figures. Deleting either side of a transfer deletes both, and deleting a split deletes its lines. A reconciled transaction (or a transfer whose other side is reconciled) cannot be deleted (tool error). ${MONEY} Returns { transaction }: the transaction as it was, with its amount. ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) => ({
      transaction: await deleteTransaction(env, actor, input.budget_id, input.transaction_id),
    }),
  },
  {
    name: "bulk_update_transactions",
    description: `Change 1 to 100 transactions of a plan at once with one op, all or nothing: every id is checked first and a refused request changes nothing. ${MONEY} ops and their value: clear / unclear (no value) set cleared or uncleared; categorize (value: a category id, or "ready_to_assign" for Inflow: Ready to Assign) sets the category and approves the row; memo (value: text, or null to clear) sets the memo (a transfer's other side follows); move (value: an account id) moves the rows to that account and keeps their other fields; duplicate (no value) adds a hand-entered, approved copy of each row in the same account (a split with its lines, a transfer as a new pair; the copy has no bank fields and no flag). Reconciled rows are skipped, so are rows that already have the value, and for categorize those that take no category (a split, a tracking account's row, an on-plan transfer, a credit Starting Balance); each skipped id is listed with its reason. A closed target account, an unknown id or category, a transfer moved into its other account and a categorized row moved to a tracking account refuse the whole request, naming the id. Returns { op, changed, skipped: [{ id, reason }], others (other sides of transfers that changed too), copies: [{ id, copy_id }] (duplicate), transactions } where transactions are the rows after the change (the copies for duplicate), each as get_transaction returns it. ${dates("date")} ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      ids: z.array(Id).min(1).max(100),
      op: z.enum(["clear", "unclear", "categorize", "memo", "move", "duplicate"]),
      value: z
        .string()
        .max(500)
        .nullable()
        .optional()
        .describe(
          "categorize: a category id or ready_to_assign; memo: the text or null; move: an account id; send nothing for clear, unclear and duplicate",
        ),
    }),
    run: async (
      input: {
        budget_id: string;
        ids: string[];
        op: "clear" | "unclear" | "categorize" | "memo" | "move" | "duplicate";
        value?: string | null;
      },
      { env, actor },
    ) => {
      const { budget_id, ids, op, value } = input;
      const body =
        op === "clear" || op === "unclear" || op === "duplicate"
          ? { op, ids }
          : { op, ids, value: value as string };
      return bulkTransactions(env, actor, budget_id, body as TransactionBulkRequest);
    },
  },
  {
    name: "delete_transactions",
    description: `Delete 1 to 100 transactions of a plan at once (soft delete), all or nothing. Deleting either side of a transfer deletes both, and deleting a split deletes its lines; a deleted bank import is never imported again. A reconciled transaction (or a transfer whose other side is reconciled) is refused (409 transaction_reconciled) unless confirm_reconciled is true. It cannot be undone through the API. An unknown id refuses the whole request and nothing is deleted. ${MONEY} Returns { op, changed, skipped, others (other sides of transfers deleted too), copies, transactions } where transactions are the rows as they were. ${dates("date")} ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      ids: z.array(Id).min(1).max(100),
      confirm_reconciled: z.boolean().optional(),
    }),
    run: async (
      input: { budget_id: string; ids: string[]; confirm_reconciled?: boolean },
      { env, actor },
    ) =>
      bulkTransactions(env, actor, input.budget_id, {
        op: "delete",
        ids: input.ids,
        confirm_reconciled: input.confirm_reconciled,
      }),
  },
  {
    name: "flag_transactions",
    description: `Set or clear the colour flag of 1 to 100 transactions at once, all or nothing. color is red, orange, yellow, green, blue or purple, or null to clear. A transfer's two sides are flagged separately and a split's lines carry no flag. The rows are not approved by it, and reconciled rows can be flagged. ${MONEY} Returns { op, changed, skipped (rows that already had the colour), others, copies, transactions } where transactions are the rows after the change, each with flag_color. ${dates("date")} ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      ids: z.array(Id).min(1).max(100),
      color: FlagColor.nullable(),
    }),
    run: async (
      input: { budget_id: string; ids: string[]; color: string | null },
      { env, actor },
    ) =>
      bulkTransactions(env, actor, input.budget_id, {
        op: "flag",
        ids: input.ids,
        value: input.color as never,
      }),
  },
];
