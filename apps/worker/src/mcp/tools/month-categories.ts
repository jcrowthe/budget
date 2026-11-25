import { Milliunits } from "@budget/schema/common/money";
import { AssignedMonth } from "@budget/schema/month-categories";
import { z } from "zod";
import {
  getCardPaymentStatus,
  getMonthCategory,
  setAssignedAndRead,
} from "../../services/month-categories";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_month_category",
    description: `One category's figures for one month of a plan. ${MONTH} ${MONEY} Returns { leftover, assigned, cash_activity, credit_activity, available, note, upcoming, upcoming_count, available_after_upcoming, payment }: upcoming (the sum of the scheduled transactions dated inside the month; a repeating schedule counts every date in it), upcoming_count and available_after_upcoming (available + upcoming, not clamped; a credit card payment category has 0, 0 and its available); leftover is carried from the previous month; credit_activity is the net spending on credit accounts (credit card and line of credit) and cash_activity everything else; available = leftover + assigned + cash_activity + credit_activity; note is the category's note (the same in every month) or null. Credit overspending is overspent card spending that becomes card debt and leaves Ready to Assign alone; cash overspending is taken from next month's Ready to Assign. payment is a credit card payment category's card status ({ state, underfunded, overspent_categories, current_balance, prior_balance, spending_and_outflows, interest_charges, payments_and_inflows, available, paid }, see get_card_payment_status) and null for other categories.`,
    inputSchema: z.object({ budget_id: Id, month: AssignedMonth, category_id: Id }),
    run: async (input: { budget_id: string; month: string; category_id: string }, { env }) =>
      getMonthCategory(env, input.budget_id, input.month, input.category_id),
  },
  {
    name: "get_card_payment_status",
    description: `A credit card's payment status for one month of a plan, found by the card's account. ${MONTH} ${MONEY} Returns { account_id, category_id, name, state, underfunded, overspent_categories, current_balance, prior_balance, spending_and_outflows, interest_charges, payments_and_inflows, available, paid }: current_balance = prior_balance + spending_and_outflows + interest_charges + payments_and_inflows (interest_charges is 0: interest is not detected); underfunded = max(0, -current_balance - available); available is the payment category's Available; paid is the part of payments_and_inflows that is transfers from other accounts. state is one of paid_off (current_balance is 0 or above), overpaid (available is below 0: more was sent than was set aside), enough (underfunded is 0), overspent_categories (underfunded and some categories were overspent with this card) or underfunded. An account that is not a credit card of the plan, or an unknown id, is a tool error.`,
    inputSchema: z.object({ budget_id: Id, month: AssignedMonth, account_id: Id }),
    run: async (input: { budget_id: string; month: string; account_id: string }, { env }) =>
      getCardPaymentStatus(env, input.budget_id, input.month, input.account_id),
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
