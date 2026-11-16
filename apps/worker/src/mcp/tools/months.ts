import { Month } from "@budget/schema/common/dates";
import { InputMonth, MonthNoteUpdate } from "@budget/schema/months";
import { z } from "zod";
import { NotFound } from "../../middleware/errors";
import { getMonthRange, getPlanMonth, listPlanMonths, setMonthNote } from "../../services/months";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const MAX_MONTHS = 120; // the same limit as routes/months.ts
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

export const tools: McpToolDef[] = [
  {
    name: "get_plan_month",
    description: `Read one month of a plan. ${MONTH} ${MONEY} Returns { month, note, ready_to_assign, rta_breakdown, groups, uncategorized }: each group and each of its categories has id, name, hidden, assigned, activity and available; categories also carried and target.`,
    inputSchema: z.object({ budget_id: Id, month: Month }),
    run: async (input: { budget_id: string; month: string }, { env }) =>
      getPlanMonth(env, input.budget_id, input.month),
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
