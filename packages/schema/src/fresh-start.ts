import { z } from "@hono/zod-openapi";
import { PlanDate } from "./accounts";
import { BudgetCreate } from "./budgets";
import { dataEnvelope } from "./common/envelope";

/** The inline error and the 422 detail when a Fresh Start name is already a plan's name. */
export const PLAN_NAME_TAKEN = "The plan name already exists.";

/** The key two plan names clash on: case and surrounding spaces do not matter. */
export const planNameKey = (name: string): string => name.trim().toLowerCase();

/** True when `name` clashes with one of `names` (the names of the active plans). */
export function planNameTaken(names: readonly string[], name: string): boolean {
  const key = planNameKey(name);
  return names.some((n) => planNameKey(n) === key);
}

const MAX_PLAN_NAME = 100;

/** `<name> (Archived on <today>)`; an old name that would pass 100 characters is cut (trailing spaces trimmed). */
export function archivedPlanName(name: string, today: string): string {
  const suffix = ` (Archived on ${today})`;
  const room = MAX_PLAN_NAME - suffix.length;
  const base = name.length + suffix.length > MAX_PLAN_NAME ? name.slice(0, room).trimEnd() : name;
  return `${base}${suffix}`;
}

export const FreshStartRequest = z
  .object({
    name: BudgetCreate.shape.name,
    stop_importing_in_archive: z.boolean().default(true).openapi({
      description:
        "Default true: the archive's linked accounts are unlinked, so bank imports continue only in the new plan. false: both plans keep importing.",
    }),
    today: PlanDate.optional().openapi({
      description: "The owner's local date (YYYY-MM-DD); default: the server's UTC date",
    }),
  })
  .openapi("FreshStartRequest");
export type FreshStartRequest = z.input<typeof FreshStartRequest>;
export type FreshStartInput = z.infer<typeof FreshStartRequest>;

export const FreshStartResult = z
  .object({ new_budget_id: z.string(), archived_budget_id: z.string() })
  .openapi("FreshStartResult");
export type FreshStartResult = z.infer<typeof FreshStartResult>;

export const FreshStartResponse = dataEnvelope(FreshStartResult).openapi("FreshStartResponse");
