import { InputMonth } from "@budget/schema/months";
import { TargetBody, Today } from "@budget/schema/targets";
import { z } from "zod";
import { NotFound } from "../../middleware/errors";
import { deleteTarget, setTarget, setTargetSnooze } from "../../services/targets";
import { dates, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const isId = (s: string) => z.uuid().safeParse(s).success;

type SetInput = Omit<TargetBody, "cadence" | "behavior"> & {
  budget_id: string;
  category_id: string;
  cadence: TargetBody["cadence"];
  behavior: TargetBody["behavior"];
  today?: string;
};

export const tools: McpToolDef[] = [
  {
    name: "set_category_target",
    description: `Create or replace a category's target; a replace keeps the first creation date. ${MONEY} ${dates("today", "due_date")} ${MONTH} Returns { target }: the stored target with its fields and created_month (the month it applies from; earlier months show no target). today (YYYY-MM-DD, default the server's UTC date) sets the creation month of a new target. Kinds: weekly (set_aside or refill; amount each week on day_of_week, 0 = Sunday); monthly (set_aside or refill; amount each month by day_of_month, null or absent = the last day); yearly (set_aside or refill; amount each year by due_date); custom set_aside or fill_up (amount by due_date, optional repeat every 1 to 11 months or years); custom balance (reach amount by due_month, or eventually when it is absent). Other combinations are refused. (Not for the Credit Card Payments group or its payment categories: that is a 422.)`,
    inputSchema: z.object({
      budget_id: Id,
      category_id: Id,
      ...TargetBody.shape,
      today: Today.optional(),
    }),
    run: async (input: SetInput, { env, actor }) => {
      const { today, ...rest } = input;
      if (!isId(input.budget_id)) throw new NotFound("Plan");
      if (!isId(input.category_id)) throw new NotFound("Category");
      return { target: await setTarget(env, actor, rest, { today }) };
    },
  },
  {
    name: "delete_category_target",
    description: `Delete a category's target; its assigned amounts and balance are unchanged. ${MONEY} Returns { deleted }: the target as it was, with its amount.`,
    inputSchema: z.object({ budget_id: Id, category_id: Id }),
    run: async (input: { budget_id: string; category_id: string }, { env, actor }) => {
      if (!isId(input.budget_id)) throw new NotFound("Plan");
      if (!isId(input.category_id)) throw new NotFound("Category");
      return { deleted: await deleteTarget(env, actor, input) };
    },
  },
  {
    name: "snooze_target",
    description: `Snooze or unsnooze a category's target for one month. While snoozed the category counts as having no target: it is not underfunded and is left out of Auto-Assign's Underfunded and Reduce Overfunding; the target is active again from the next month. Only the owner's current month can be snoozed (decided by today) and only a category with a target; otherwise the call is refused and nothing is stored. ${MONTH} ${dates("today")} Returns { month, category_id, snoozed }. The change is recorded in the history with its actor.`,
    inputSchema: z.object({
      budget_id: Id,
      month: InputMonth,
      category_id: Id,
      snoozed: z.boolean(),
      today: Today.optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        month: string;
        category_id: string;
        snoozed: boolean;
        today?: string;
      },
      { env, actor },
    ) => {
      if (!isId(input.budget_id)) throw new NotFound("Plan");
      if (!isId(input.category_id)) throw new NotFound("Category");
      const { today, ...rest } = input;
      return setTargetSnooze(env, actor, rest, { today });
    },
  },
];
