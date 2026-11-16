import { AutoAssignStrategy } from "@budget/schema/auto-assign";
import { InputMonth } from "@budget/schema/months";
import { PlanView } from "@budget/schema/plan-views";
import { Today } from "@budget/schema/targets";
import { z } from "zod";
import { autoAssign, previewAutoAssign } from "../../services/auto-assign";
import { dates, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const STRATEGIES =
  "Strategies: underfunded ADDS each category's target to-go this month to its Assigned (a snoozed target counts as none); assigned_last_month SETS Assigned to last month's Assigned; spent_last_month SETS Assigned to last month's spending (a positive amount); average_assigned SETS Assigned to the average monthly Assigned and average_spent to the average monthly spending, over the months since the category's first month, at most the last 12, a month with nothing counting as 0; reduce_overfunding REMOVES the Assigned above this month's need (never below 0 Assigned); reset_available SETS Assigned so that Available is 0; reset_assigned SETS Assigned to 0.";
const SCOPE =
  "Scope: category_ids (1 to 500 categories, hidden ones allowed) or view (all, overspent, underfunded, overfunded, money_available, snoozed), not both; default every visible category. Hidden categories are never touched without category_ids.";
const TODAY = `${dates("today")} today decides the current month for target figures; default: the server's UTC date.`;

const scopeShape = {
  category_ids: z.array(Id).min(1).max(500).optional(),
  view: PlanView.optional(),
  today: Today.optional(),
};
type ScopeInput = { category_ids?: string[]; view?: PlanView; today?: string };

const checkScope = (i: ScopeInput) => {
  if (i.category_ids && i.view) throw new Error("Give category_ids or view, not both");
};

export const tools: McpToolDef[] = [
  {
    name: "preview_auto_assign",
    description: `What each Auto-Assign option would do for a month, without changing anything. ${MONTH} ${MONEY} ${STRATEGIES} ${SCOPE} Returns { category_count, underfunded, assigned_last_month, spent_last_month, average_assigned, average_spent, reduce_overfunding, reset_available, reset_assigned }: underfunded is the amount that would be added and reduce_overfunding the amount that would be removed; the others are the resulting total Assigned (reset_available and reset_assigned are 0). ${TODAY} Credit card payment categories are left out of underfunded, reduce_overfunding, spent_last_month and average_spent.`,
    inputSchema: z.object({ budget_id: Id, month: InputMonth, ...scopeShape }),
    run: async (input: { budget_id: string; month: string } & ScopeInput, { env }) => {
      checkScope(input);
      return previewAutoAssign(
        env,
        input.budget_id,
        input.month,
        { category_ids: input.category_ids, view: input.view },
        input.today,
      );
    },
  },
  {
    name: "auto_assign",
    description: `Apply one Auto-Assign option to a month. This changes Assigned at once, with no confirmation; each changed category is recorded in the history with its actor, and Ready to Assign may go negative. ${MONTH} ${MONEY} ${STRATEGIES} ${SCOPE} Returns { month, strategy, changed }: the category-months whose Assigned changed (month, category_id, assigned). ${TODAY} Credit card payment categories are left out of underfunded, reduce_overfunding, spent_last_month and average_spent.`,
    inputSchema: z.object({
      budget_id: Id,
      month: InputMonth,
      strategy: AutoAssignStrategy,
      ...scopeShape,
    }),
    run: async (
      input: { budget_id: string; month: string; strategy: AutoAssignStrategy } & ScopeInput,
      { env, actor },
    ) => {
      checkScope(input);
      return autoAssign(
        env,
        actor,
        {
          budget_id: input.budget_id,
          month: input.month,
          strategy: input.strategy,
          category_ids: input.category_ids,
          view: input.view,
        },
        input.today,
      );
    },
  },
];
