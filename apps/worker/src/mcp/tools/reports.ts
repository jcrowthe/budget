import { Month } from "@budget/schema/common/dates";
import { monthIndex } from "@budget/schema/report-range";
import { MAX_REPORT_MONTHS } from "@budget/schema/reports";
import { z } from "zod";
import { getNetWorth, getSpendingBreakdown, listReportTransactions } from "../../services/reports";
import { DATE, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

function checkMonths(start: string, end: string) {
  if (start > end) throw new Error("start_month must not be after end_month");
  if (monthIndex(end) - monthIndex(start) >= MAX_REPORT_MONTHS) {
    throw new Error(`At most ${MAX_REPORT_MONTHS} months`);
  }
}

export const tools: McpToolDef[] = [
  {
    name: "get_net_worth",
    description: `Net worth at the end of each month, for "what was my net worth each month this year?". Every account counts, tracking accounts and loans included, except those in excluded_account_ids. Each month, accounts with a positive balance add to assets and accounts with a negative balance to debts. ${MONEY} Debts are negative. ${MONTH} Omit both start_month and end_month for the plan's first month through the current month; give both or neither. Returns { first_month, start_month, end_month, has_data, assets, debts, net_worth, change, change_pct, months }: the top-level assets, debts and net_worth are the last month's; change and change_pct (percent, one decimal, or null) are over the range; each of months (oldest first) has month, assets, debts, net_worth, change, change_pct and accounts [{ id, name, balance }].`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month.optional(),
      end_month: Month.optional(),
      excluded_account_ids: z.array(Id).max(2000).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        start_month?: string;
        end_month?: string;
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      if ((input.start_month === undefined) !== (input.end_month === undefined)) {
        throw new Error("Give both start_month and end_month, or neither");
      }
      if (input.start_month && input.end_month && input.start_month > input.end_month) {
        throw new Error("start_month must not be after end_month");
      }
      if (
        input.start_month &&
        input.end_month &&
        monthIndex(input.end_month) - monthIndex(input.start_month) >= MAX_REPORT_MONTHS
      ) {
        throw new Error(`At most ${MAX_REPORT_MONTHS} months`);
      }
      return getNetWorth(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
  {
    name: "get_spending_breakdown",
    description: `How much did I spend by category from June to November? Spending per category (or per category group) over a range of months. ${MONEY} Spending figures here are positive, while a transaction's own amount is signed (an outflow is negative). ${MONTH} Both start_month and end_month are required. Spending counts rows of on-plan accounts in the range: split lines in their own categories (never the split parent) and transfers to tracking accounts. Transfers between two on-plan accounts, inflows to Ready to Assign and Starting Balances never count; a row with no category is Uncategorized. Refunds reduce their category; hidden categories count. group_by "group" lists category groups; group_id drills into one group's categories. Returns { start_month, end_month, months, days, group_by, group, total, average_monthly, average_daily, most_frequent: { id, name, transaction_count } or null, largest_outflow: { transaction_id, payee_name, amount } or null, items: [{ id, name, group_name, total, share_pct, transaction_count }] } with items largest first; the item id "uncategorized" is Uncategorized; excluded_category_ids may hold it too. The averages are the total over the months and over the calendar days of those months.`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month,
      end_month: Month,
      group_by: z.enum(["category", "group"]).optional(),
      group_id: Id.optional(),
      excluded_category_ids: z.array(Id).max(2000).optional(),
      excluded_account_ids: z.array(Id).max(2000).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        start_month: string;
        end_month: string;
        group_by?: "category" | "group";
        group_id?: string;
        excluded_category_ids?: string[];
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      checkMonths(input.start_month, input.end_month);
      return getSpendingBreakdown(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        group_by: input.group_by ?? "category",
        group_id: input.group_id,
        excluded_category_ids: input.excluded_category_ids ?? [],
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
  {
    name: "list_report_transactions",
    description: `Which transactions make up a category's spending from June to November? Lists the counted transactions of one category, one category group, or Uncategorized over a range, newest first. ${MONEY} A transaction's amount here is signed (an outflow is negative), while get_spending_breakdown reports spending as positive. ${MONTH} ${DATE} Give exactly one of category_id, group_id or uncategorized=true. Spending counts rows of on-plan accounts in the range: split lines in their own categories (never the split parent) and transfers to tracking accounts. Transfers between two on-plan accounts, inflows to Ready to Assign and Starting Balances never count; a row with no category is Uncategorized. Returns { transactions: [{ transaction_id, subtransaction_id (set for a split line), account_id, account_name, date, payee_name, memo, amount, category_id, category_name, cleared }] }.`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month,
      end_month: Month,
      category_id: Id.optional(),
      group_id: Id.optional(),
      uncategorized: z.literal(true).optional(),
      excluded_account_ids: z.array(Id).max(2000).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        start_month: string;
        end_month: string;
        category_id?: string;
        group_id?: string;
        uncategorized?: true;
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      checkMonths(input.start_month, input.end_month);
      const given = [input.category_id, input.group_id, input.uncategorized].filter(
        (x) => x !== undefined,
      ).length;
      if (given !== 1)
        throw new Error("Give exactly one of category_id, group_id or uncategorized");
      return listReportTransactions(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        category_id: input.category_id,
        group_id: input.group_id,
        uncategorized: input.uncategorized ? "true" : undefined,
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
];
