import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const BankEnvironment = z.enum(["production", "sandbox"]).openapi("BankEnvironment", {
  description:
    "Which Plaid environment the plan's bank connections use. production (default) or sandbox (Plaid test banks).",
});

export const Budget = z
  .object({
    id: z.uuid(),
    name: z.string(),
    created_at: z.string(),
    last_modified_on: z.string(),
    last_opened_at: z.string().nullable().openapi({
      description: "ISO 8601 time the plan was last opened in the app; null if never",
    }),
    bank_environment: BankEnvironment,
  })
  .openapi("Budget");

export const BudgetCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    bank_environment: BankEnvironment.optional(),
  })
  .openapi("BudgetCreate");
export const BudgetUpdate = BudgetCreate.partial()
  .extend({
    opened: z.literal(true).optional().openapi({
      description:
        "Set to true to record that the plan was opened (stamps last_opened_at = now). Not a change: no history entry.",
    }),
  })
  .openapi("BudgetUpdate");

export const BudgetResponse = dataEnvelope(z.object({ budget: Budget })).openapi("BudgetResponse");
export const BudgetListResponse = dataEnvelope(z.object({ budgets: z.array(Budget) })).openapi(
  "BudgetListResponse",
);

export type BankEnvironment = z.infer<typeof BankEnvironment>;
export type Budget = z.infer<typeof Budget>;
export type BudgetCreate = z.infer<typeof BudgetCreate>;
export type BudgetUpdate = z.infer<typeof BudgetUpdate>;
