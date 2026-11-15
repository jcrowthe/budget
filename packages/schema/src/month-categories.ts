import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

/** The month path parameter: a first day, in a sane year range. (Same rule as the private one in months.ts.) */
export const AssignedMonth = Month.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199");

export const AssignedUpdate = z.object({ assigned: Milliunits }).openapi("AssignedUpdate");

export const MonthCategoryAmounts = z
  .object({
    id: z.string(),
    month: Month,
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
  })
  .openapi("MonthCategoryAmounts");

export const AssignedResult = z
  .object({ category: MonthCategoryAmounts, ready_to_assign: Milliunits })
  .openapi("AssignedResult");

export const AssignedResultResponse =
  dataEnvelope(AssignedResult).openapi("AssignedResultResponse");

export type AssignedUpdate = z.infer<typeof AssignedUpdate>;
export type MonthCategoryAmounts = z.infer<typeof MonthCategoryAmounts>;
export type AssignedResult = z.infer<typeof AssignedResult>;
