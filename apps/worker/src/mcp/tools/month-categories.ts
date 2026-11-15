import { Milliunits } from "@budget/schema/common/money";
import { AssignedMonth } from "@budget/schema/month-categories";
import { z } from "zod";
import { setAssignedAndRead } from "../../services/month-categories";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "set_assigned",
    description:
      "Set a category's Assigned amount for one month of a plan (milliunits; negative allowed). Returns the category's month amounts and the month's new Ready to Assign.",
    inputSchema: z.object({
      budget_id: z.string().min(1),
      month: AssignedMonth,
      category_id: z.string().min(1),
      assigned: Milliunits,
    }),
    run: async (
      input: { budget_id: string; month: string; category_id: string; assigned: number },
      { env, actor },
    ) => setAssignedAndRead(env, actor, input),
  },
];
