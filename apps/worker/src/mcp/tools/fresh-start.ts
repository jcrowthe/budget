import { PlanDate } from "@budget/schema/accounts";
import { BudgetCreate } from "@budget/schema/budgets";
import { z } from "zod";
import { freshStartBudget } from "../../services/fresh-start";
import { DATE, Id } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "fresh_start_budget",
    description: `Make a Fresh Start: copy a plan's structure into a NEW plan that starts today, and rename the old plan as an archive. Copied: accounts (closed ones stay closed), category groups, categories and their notes, targets, scheduled transactions (transfers and splits too), payees, payee renaming rules, custom views, expected income, flag names, the plan's formats, and the notes and target snoozes of the current and later months. Not copied: transactions, assigned amounts, past months' notes and snoozes, reports settings, import settings. Each account of the new plan gets a Starting Balance dated today, cleared, approved: $0 for an unlinked account, and the bank's balance for a linked one (linked accounts stay linked in the new plan, with imports from today). The old plan is renamed "<name> (Archived on YYYY-MM-DD)" and keeps every transaction and assigned amount. stop_importing_in_archive (default true) removes the archive's bank links so imports continue only in the new plan; false keeps both plans importing. name is 1 to 100 characters and must differ from every active plan's name, ignoring case and surrounding spaces, the current plan included (otherwise a tool error: The plan name already exists.). This cannot be undone, so confirm must be true. today defaults to the server's UTC date. ${DATE} Returns { new_budget_id, archived_budget_id }.`,
    inputSchema: z.object({
      budget_id: Id,
      name: BudgetCreate.shape.name,
      stop_importing_in_archive: z.boolean().optional(),
      today: PlanDate.optional(),
      confirm: z.literal(true),
    }),
    run: async (
      input: {
        budget_id: string;
        name: string;
        stop_importing_in_archive?: boolean;
        today?: string;
        confirm: true;
      },
      { env, actor },
    ) =>
      freshStartBudget(env, actor, input.budget_id, {
        name: input.name,
        stop_importing_in_archive: input.stop_importing_in_archive,
        today: input.today,
      }),
  },
];
