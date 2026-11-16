import { Milliunits } from "@budget/schema/common/money";
import { AssignedMonth } from "@budget/schema/month-categories";
import { z } from "zod";
import { getMonthCategory, setAssignedAndRead } from "../../services/month-categories";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_month_category",
    description: `One category's figures for one month of a plan. ${MONTH} ${MONEY} Returns { leftover, assigned, cash_activity, credit_activity, available, note }: leftover is carried from the previous month; credit_activity is 0 until credit card spending exists, so all activity is cash_activity; available = leftover + assigned + cash_activity + credit_activity; note is the category's note (the same in every month) or null.`,
    inputSchema: z.object({ budget_id: Id, month: AssignedMonth, category_id: Id }),
    run: async (input: { budget_id: string; month: string; category_id: string }, { env }) =>
      getMonthCategory(env, input.budget_id, input.month, input.category_id),
  },
  {
    name: "set_assigned",
    description: `Set a category's Assigned amount for one month of a plan. ${MONTH} ${MONEY} Assigned may be negative. Returns { category: { id, month, assigned, activity, available }, ready_to_assign }: the category's new month amounts and the month's new Ready to Assign.`,
    inputSchema: z.object({
      budget_id: Id,
      month: AssignedMonth,
      category_id: Id,
      assigned: Milliunits,
    }),
    run: async (
      input: { budget_id: string; month: string; category_id: string; assigned: number },
      { env, actor },
    ) => setAssignedAndRead(env, actor, input),
  },
];
