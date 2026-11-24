import { Month } from "@budget/schema/common/dates";
import { InputMonth, MonthNoteUpdate } from "@budget/schema/months";
import { PlanView } from "@budget/schema/plan-views";
import { Today } from "@budget/schema/targets";
import { z } from "zod";
import { NotFound } from "../../middleware/errors";
import {
  getMonthRange,
  getMonthSummary,
  getPlanMonth,
  listPlanMonths,
  planMonthError,
  setMonthNote,
} from "../../services/months";
import { dates, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const TODAY = `${dates("today")} today decides the current month for target figures; default: the server's UTC date.`;
const MAX_MONTHS = 120; // the same limit as routes/months.ts
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

export const tools: McpToolDef[] = [
  {
    name: "get_plan_month",
    description: `Read one month of a plan. ${MONTH} ${MONEY} Returns { month, note, ready_to_assign, rta_breakdown, groups, uncategorized }: each group and each of its categories has id, name, hidden, assigned, activity and available; categories also carried, target, note and target_snoozed (true while its target is snoozed this month). view (all, overspent, underfunded, overfunded, money_available, snoozed) narrows to the categories the Plan page's view shows; default all. A category's target holds its figures for the month. A month more than 10 years from today is an error. ${TODAY} Groups carry kind (credit_card_payments or null); categories also carry kind (credit_card_payment or null), account_id, cash_spending, credit_spending, overspent ({ cash, credit } or null) and state (ok, credit_overspent or cash_overspent); payment categories also carry payment ({ state, underfunded, overspent_categories, current_balance, prior_balance, spending_and_outflows, interest_charges, payments_and_inflows, available, paid }, null for other categories). Credit overspending is overspent card spending that becomes card debt and leaves Ready to Assign alone; cash overspending is taken from next month's Ready to Assign.`,
    inputSchema: z.object({
      budget_id: Id,
      month: Month,
      view: PlanView.optional(),
      today: Today.optional(),
    }),
    run: async (
      input: { budget_id: string; month: string; view?: PlanView; today?: string },
      { env },
    ) => {
      const bad = planMonthError(input.month, input.today);
      if (bad) throw new Error(bad);
      return getPlanMonth(env, input.budget_id, input.month, input.today, input.view);
    },
  },
  {
    name: "get_month_summary",
    description: `Totals of one month of a plan: with category_ids, exactly those categories (hidden ones included); without, every category that is not hidden and not in a hidden group. ${MONTH} ${MONEY} Returns { leftover, assigned, activity, available }: leftover is the positive Available carried from the previous month; available = leftover + assigned + activity. An unknown category id is an error. view (all, overspent, underfunded, overfunded, money_available, snoozed) narrows to the categories the Plan page's view shows; default all. With view, totals cover only the categories that view shows; category_ids and view together are an error. ${TODAY}`,
    inputSchema: z.object({
      budget_id: Id,
      month: InputMonth,
      category_ids: z.array(Id).min(1).max(500).optional(),
      view: PlanView.optional(),
      today: Today.optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        month: string;
        category_ids?: string[];
        view?: PlanView;
        today?: string;
      },
      { env },
    ) => {
      if (input.category_ids && input.view) throw new Error("Give category_ids or view, not both");
      return getMonthSummary(
        env,
        input.budget_id,
        input.month,
        input.category_ids && [...new Set(input.category_ids)],
        input.today,
        input.view,
      );
    },
  },
  {
    name: "list_plan_months",
    description: `Summaries of a plan's months from from to to, inclusive, at most ${MAX_MONTHS} months; to must not be before from. ${MONTH} ${MONEY} Returns { months }: each with month, note, ready_to_assign, assigned, activity and available.`,
    inputSchema: z.object({ budget_id: Id, from: Month, to: Month }),
    run: async (input: { budget_id: string; from: string; to: string }, { env }) => {
      const span = monthIndex(input.to) - monthIndex(input.from);
      if (span < 0 || span >= MAX_MONTHS) {
        throw new Error(
          `"to" must not be before "from", and the range at most ${MAX_MONTHS} months`,
        );
      }
      return { months: await listPlanMonths(env, input.budget_id, input.from, input.to) };
    },
  },
  {
    name: "get_month_range",
    description: `The facts behind a plan's month navigation limits. ${MONTH} Returns { first_month, last_assigned_month }: first_month is the earliest of the plan's creation month and the first month with an assigned amount, a note or a transaction; last_assigned_month is the latest month with an assigned amount, or null.`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => getMonthRange(env, input.budget_id),
  },
  {
    name: "set_month_note",
    description: `Set or clear the free-text note of one month of a plan. ${MONTH} An empty or whitespace-only note, or null, clears it; at most 5000 characters. Returns { month, note } as stored (note is null when cleared).`,
    inputSchema: z.object({
      budget_id: Id,
      month: InputMonth,
      note: MonthNoteUpdate.shape.note,
    }),
    run: (input: { budget_id: string; month: string; note: string | null }, { env, actor }) => {
      if (!z.uuid().safeParse(input.budget_id).success) throw new NotFound("Plan");
      return setMonthNote(env, actor, input);
    },
  },
];
