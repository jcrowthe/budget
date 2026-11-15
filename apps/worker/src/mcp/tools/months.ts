import { Month } from "@budget/schema/common/dates";
import { z } from "zod";
import { getPlanMonth } from "../../services/months";
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
];
