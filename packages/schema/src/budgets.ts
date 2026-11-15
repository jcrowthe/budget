import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const Budget = z
  .object({
    id: z.uuid(),
    name: z.string(),
    created_at: z.string(),
    last_modified_on: z.string(),
  })
  .openapi("Budget");

export const BudgetCreate = z
  .object({ name: z.string().trim().min(1).max(100) })
  .openapi("BudgetCreate");
export const BudgetUpdate = BudgetCreate.partial().openapi("BudgetUpdate");

export const BudgetResponse = dataEnvelope(z.object({ budget: Budget })).openapi("BudgetResponse");
export const BudgetListResponse = dataEnvelope(z.object({ budgets: z.array(Budget) })).openapi(
  "BudgetListResponse",
);

export type Budget = z.infer<typeof Budget>;
export type BudgetCreate = z.infer<typeof BudgetCreate>;
export type BudgetUpdate = z.infer<typeof BudgetUpdate>;
