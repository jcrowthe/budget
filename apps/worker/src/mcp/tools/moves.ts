import { Milliunits } from "@budget/schema/common/money";
import { InputMonth } from "@budget/schema/months";
import { z } from "zod";
import { coverAndRead, moveAndRead } from "../../services/moves";
import { Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const RETURNS =
  "Returns { move_id, month, amount, from, to, ready_to_assign }: from and to are { id, month, assigned, activity, available } (null for Ready to Assign) after the move, and ready_to_assign is the month's new Ready to Assign.";

export const tools: McpToolDef[] = [
  {
    name: "move_money",
    description: `Move money in one plan month from a category or Ready to Assign to another category or Ready to Assign: the source's Assigned goes down and the destination's up by the amount. 'from' and 'to' are each a category id or "ready_to_assign" (not both, and not equal). ${MONEY} The amount must be positive; moving more than a category's Available is allowed. ${MONTH} One atomic change, recorded in history as one move. ${RETURNS}`,
    inputSchema: z.object({
      budget_id: Id,
      month: InputMonth,
      from: Id,
      to: Id,
      amount: Milliunits.positive(),
    }),
    run: async (
      input: { budget_id: string; month: string; from: string; to: string; amount: number },
      { env, actor },
    ) => moveAndRead(env, actor, input),
  },
  {
    name: "cover_overspending",
    description: `Cover an overspent category in one plan month: moves exactly its negative Available ${MONEY} from 'from' (a category id or "ready_to_assign") into it, so its Available becomes 0. ${MONTH} Fails when the category is not overspent. ${RETURNS}`,
    inputSchema: z.object({ budget_id: Id, month: InputMonth, category_id: Id, from: Id }),
    run: async (
      input: { budget_id: string; month: string; category_id: string; from: string },
      { env, actor },
    ) => coverAndRead(env, actor, input),
  },
];
