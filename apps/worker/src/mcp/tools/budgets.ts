import { BudgetCreate } from "@budget/schema/budgets";
import { z } from "zod";
import {
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  updateBudget,
} from "../../services/budgets";
import { Id } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_budgets",
    description:
      "List every plan (a plan is a budget). Returns { budgets }: each with id, name, bank_environment, created_at, last_modified_on and last_opened_at (null if never opened in the app).",
    inputSchema: z.object({}),
    run: async (_input, { env }) => ({ budgets: await listBudgets(env) }),
  },
  {
    name: "get_budget",
    description:
      "Read one plan. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at. An unknown or deleted plan is a tool error (Plan not found).",
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      budget: await getBudget(env, input.budget_id),
    }),
  },
  {
    name: "create_budget",
    description:
      "Create a plan (budget). name is 1 to 100 characters. bank_environment is the Plaid environment of the plan's bank connections: production (default, real banks) or sandbox (Plaid test banks). A new plan starts with the default category groups Bills, Needs and Wants and their categories. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at (null).",
    inputSchema: z.object({
      name: BudgetCreate.shape.name,
      bank_environment: BudgetCreate.shape.bank_environment,
    }),
    run: async (input: z.infer<typeof BudgetCreate>, { env, actor }) => ({
      budget: await createBudget(env, actor, input),
    }),
  },
  {
    name: "update_budget",
    description:
      "Rename a plan or change its bank_environment (production or sandbox: the Plaid environment its bank connections use). Send only what changes. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at.",
    inputSchema: z.object({
      budget_id: Id,
      name: BudgetCreate.shape.name.optional(),
      bank_environment: BudgetCreate.shape.bank_environment,
    }),
    run: async (
      input: { budget_id: string; name?: string; bank_environment?: "production" | "sandbox" },
      { env, actor },
    ) => {
      const { budget_id, ...rest } = input;
      if (rest.name === undefined && rest.bank_environment === undefined) {
        throw new Error("Nothing to update: give name or bank_environment");
      }
      return { budget: await updateBudget(env, actor, budget_id, rest) };
    },
  },
  {
    name: "delete_budget",
    description:
      "Delete a plan (soft delete): it leaves the plan list and every later read of it is a tool error (Plan not found). Returns { deleted: true }.",
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env, actor }) => {
      await deleteBudget(env, actor, input.budget_id);
      return { deleted: true };
    },
  },
];
