import { BudgetCreate } from "@budget/schema/budgets";
import { z } from "zod";
import { createBudget, listBudgets } from "../../services/budgets";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_budgets",
    description: "List all plans (budgets).",
    inputSchema: z.object({}),
    run: async (_input, { env }) => ({ budgets: await listBudgets(env) }),
  },
  {
    name: "create_budget",
    description: "Create a plan (budget) with the given name.",
    inputSchema: z.object({ name: BudgetCreate.shape.name }),
    run: async (input: { name: string }, { env, actor }) => ({
      budget: await createBudget(env, actor, input),
    }),
  },
];
