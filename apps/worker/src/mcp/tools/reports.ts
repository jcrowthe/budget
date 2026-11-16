import { Month } from "@budget/schema/common/dates";
import { monthIndex } from "@budget/schema/report-range";
import { MAX_REPORT_MONTHS, Today } from "@budget/schema/reports";
import { z } from "zod";
import {
  getAgeOfMoney,
  getIncomeExpense,
  getNetWorth,
  getSpendingBreakdown,
  getSpendingTrends,
  listReportTransactions,
} from "../../services/reports";
import { dates, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

function checkMonths(start: string, end: string) {
  if (start > end) throw new Error("start_month must not be after end_month");
  if (monthIndex(end) - monthIndex(start) >= MAX_REPORT_MONTHS) {
    throw new Error(`At most ${MAX_REPORT_MONTHS} months`);
  }
}

const SPEND = `Spending counts rows of on-plan accounts in the range: split lines in their own categories (never the split parent) and transfers to tracking accounts. Transfers between two on-plan accounts, inflows to Ready to Assign and Starting Balances never count; a row with no category is Uncategorized.`;
const INCOME = `Income counts rows of on-plan accounts sent to Ready to Assign, whatever their sign, grouped by payee (a split line by its own payee, else the split's); a balance adjustment is listed as "Manual Balance Adjustment". Starting Balances and transfers are never income, and a row with no payee is listed as "(no payee)" with payee_id null.`;

export const tools: McpToolDef[] = [
  {
    name: "get_age_of_money",
    description: `Age of Money: how many days, on average, money sits in the plan's cash accounts between coming in and going out, for "how long does my money last?". Only on-plan cash accounts count (checking, savings, cash; closed ones included); credit, loan and tracking accounts are outside, so a payment or transfer to one of them is an outflow, while a transfer between two cash accounts is ignored. Each outflow spends the oldest money first (first in, first out); its age is the amount-weighted number of days since that money came in, and the value on a date is the mean age of the last 10 outflows up to that date, rounded to whole days. Returns { current_days, months: [{ month, days }] }: current_days is the current month's value, and it is null with months empty until the plan has 10 outflows; months run oldest first from the month of the 10th outflow to the current month, each the value at the month's end (the current month: as of today); days are whole days and no amount is returned. For the plan's amounts elsewhere: ${MONEY} ${MONTH} ${dates("today")} today decides the current month; default: the server's UTC date.`,
    inputSchema: z.object({ budget_id: Id, today: Today.optional() }),
    run: async (input: { budget_id: string; today?: string }, { env }) =>
      getAgeOfMoney(env, input.budget_id, { today: input.today }),
  },
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
    name: "get_spending_trends",
    description: `How has my spending changed month to month? Spending per month over a range, by category group (with group_id: by that group's categories). ${MONEY} Spending figures here are positive and a net inflow is negative. ${MONTH} Both start_month and end_month are required. ${SPEND} Returns { start_month, end_month, group, total, average_monthly, series: [{ id, name, total }], months: [{ month, total, compared_to_average, compared_pct, series: [{ id, name, amount, share_pct }] }] }, with every month of the range, oldest first. average_monthly is total ÷ months in cents; compared_to_average is the month total minus it, and compared_pct is that difference as a percent of it (one decimal); share_pct is a segment's percent of the month's spending (one decimal), null for a net inflow; series are ordered largest first; the series id "uncategorized" is Uncategorized, and excluded_category_ids may hold it.`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month,
      end_month: Month,
      group_id: Id.optional(),
      excluded_category_ids: z.array(Id).max(2000).optional(),
      excluded_account_ids: z.array(Id).max(2000).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        start_month: string;
        end_month: string;
        group_id?: string;
        excluded_category_ids?: string[];
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      checkMonths(input.start_month, input.end_month);
      return getSpendingTrends(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        group_id: input.group_id,
        excluded_category_ids: input.excluded_category_ids ?? [],
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
  {
    name: "get_income_expense",
    description: `What was my income and spending each month this quarter? Income by payee and expenses by category group and category, month by month, with average, total and net income. ${MONEY} Income is positive and expenses are negative; net income is income plus expenses. ${MONTH} Both start_month and end_month are required. ${INCOME} ${SPEND} Returns { start_month, end_month, months, income: { payees: [{ payee_id, name, months, average, total }], total }, expense: { uncategorized, groups: [{ id, name, categories: [{ id, name, hidden, months, average, total }], total }], total }, net_income }. Each figure set's months holds one amount per entry of months, and average is total ÷ months in cents. uncategorized is null when no row is uncategorized. Only rows with activity are listed, groups and categories in plan order. excluded_category_ids limits expenses only.`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month,
      end_month: Month,
      excluded_category_ids: z.array(Id).max(2000).optional(),
      excluded_account_ids: z.array(Id).max(2000).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        start_month: string;
        end_month: string;
        excluded_category_ids?: string[];
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      checkMonths(input.start_month, input.end_month);
      return getIncomeExpense(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        excluded_category_ids: input.excluded_category_ids ?? [],
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
  {
    name: "list_report_transactions",
    description: `Which transactions make up a category's spending from June to November? Lists the counted transactions of one category, one category group, Uncategorized, one payee's income, all income or all spending over a range, newest first. ${MONEY} A transaction's amount here is signed (an outflow is negative), while get_spending_breakdown reports spending as positive. ${MONTH} ${dates("date")} Give exactly one of category_id, group_id, uncategorized=true, income_payee_id, income=true or expenses=true. income_payee_id lists one payee's income ("none" for rows with no payee), income=true all income, expenses=true all spending; excluded_category_ids applies to the spending selectors. ${SPEND} ${INCOME} Returns { transactions: [{ transaction_id, subtransaction_id (set for a split line), account_id, account_name, date, payee_name, memo, amount, category_id, category_name, cleared }] }.`,
    inputSchema: z.object({
      budget_id: Id,
      start_month: Month,
      end_month: Month,
      category_id: Id.optional(),
      group_id: Id.optional(),
      uncategorized: z.literal(true).optional(),
      income_payee_id: Id.optional(),
      income: z.literal(true).optional(),
      expenses: z.literal(true).optional(),
      excluded_category_ids: z.array(Id).max(2000).optional(),
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
        income_payee_id?: string;
        income?: true;
        expenses?: true;
        excluded_category_ids?: string[];
        excluded_account_ids?: string[];
      },
      { env },
    ) => {
      checkMonths(input.start_month, input.end_month);
      const given = [
        input.category_id,
        input.group_id,
        input.uncategorized,
        input.income_payee_id,
        input.income,
        input.expenses,
      ].filter((x) => x !== undefined).length;
      if (given !== 1) {
        throw new Error(
          "Give exactly one of category_id, group_id, uncategorized, income_payee_id, income or expenses",
        );
      }
      return listReportTransactions(env, input.budget_id, {
        start_month: input.start_month,
        end_month: input.end_month,
        category_id: input.category_id,
        group_id: input.group_id,
        uncategorized: input.uncategorized ? "true" : undefined,
        income_payee_id: input.income_payee_id,
        income: input.income ? "true" : undefined,
        expenses: input.expenses ? "true" : undefined,
        excluded_category_ids: input.excluded_category_ids ?? [],
        excluded_account_ids: input.excluded_account_ids ?? [],
      });
    },
  },
];
