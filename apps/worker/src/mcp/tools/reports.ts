import { Month } from "@budget/schema/common/dates";
import { monthIndex } from "@budget/schema/report-range";
import { MAX_REPORT_MONTHS } from "@budget/schema/reports";
import { z } from "zod";
import { getNetWorth } from "../../services/reports";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

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
];
