import { TargetBody, Today } from "@budget/schema/targets";
import { z } from "zod";
import { NotFound } from "../../middleware/errors";
import { deleteTarget, setTarget } from "../../services/targets";
import { DATE, Id, MONEY, MONTH } from "../tool-text";
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
    description: `Create or replace a category's target; a replace keeps the first creation date. ${MONEY} ${DATE} ${MONTH} Returns { target }: the stored target with its fields and created_month (the month it applies from; earlier months show no target). today (YYYY-MM-DD, default the server's UTC date) sets the creation month of a new target. Kinds: weekly (set_aside or refill; amount each week on day_of_week, 0 = Sunday); monthly (set_aside or refill; amount each month by day_of_month, null or absent = the last day); yearly (set_aside or refill; amount each year by due_date); custom set_aside or fill_up (amount by due_date, optional repeat every 1 to 11 months or years); custom balance (reach amount by due_month, or eventually when it is absent). Other combinations are refused.`,
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
];
