import { Month } from "@budget/schema/common/dates";
import { InputMonth, MonthNoteUpdate } from "@budget/schema/months";
import { z } from "zod";
import { getPlanMonth, setMonthNote } from "../../services/months";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "get_plan_month",
    description:
      "Read one month of a plan: Ready to Assign with its breakdown, and Assigned/Activity/Available per category group and category, in milliunits.",
    inputSchema: z.object({ budget_id: z.string().min(1), month: Month }),
    run: async (input: { budget_id: string; month: string }, { env }) =>
      getPlanMonth(env, input.budget_id, input.month),
  },
  {
    name: "set_month_note",
    description:
      "Set or clear the free-text note of one plan month. An empty or whitespace-only note clears it. Max 5000 characters.",
    inputSchema: z.object({
      budget_id: z.uuid(),
      month: InputMonth,
      note: MonthNoteUpdate.shape.note,
    }),
    run: (input: { budget_id: string; month: string; note: string | null }, { env, actor }) =>
      setMonthNote(env, actor, input),
  },
];
