import { Milliunits } from "@budget/schema/common/money";
import { AssignedMonth } from "@budget/schema/month-categories";
import { z } from "zod";
import { setAssignedAndRead } from "../../services/month-categories";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
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
