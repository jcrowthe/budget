import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";

export const RtaBreakdown = z
  .object({
    left_over_from_previous: Milliunits,
    inflows: Milliunits,
    cash_overspending_previous: Milliunits,
    assigned_in_month: Milliunits,
    assigned_in_future: Milliunits,
  })
  .openapi("RtaBreakdown");

export const MonthCategoryDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
    carried: Milliunits,
  })
  .openapi("MonthCategoryDetail");

export const MonthGroupDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    collapsed: z.boolean(),
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
    categories: z.array(MonthCategoryDetail),
  })
  .openapi("MonthGroupDetail");

export const MonthDetail = z
  .object({
    month: Month,
    note: z.string().nullable(),
    ready_to_assign: Milliunits,
    rta_breakdown: RtaBreakdown,
    groups: z.array(MonthGroupDetail),
    uncategorized: z.object({ activity: Milliunits, available: Milliunits }).nullable(),
  })
  .openapi("MonthDetail");

export const MonthDetailResponse = dataEnvelope(MonthDetail).openapi("MonthDetailResponse");

export const MonthSummary = z
  .object({
    month: Month,
    note: z.string().nullable(),
    ready_to_assign: Milliunits,
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
  })
  .openapi("MonthSummary");

export const MonthListResponse = dataEnvelope(z.object({ months: z.array(MonthSummary) })).openapi(
  "MonthListResponse",
);

export const MonthCategory = z
  .object({ month: Month, category_id: z.uuid(), assigned: Milliunits })
  .openapi("MonthCategory");

export const AssignedSet = z
  .object({ budget_id: z.uuid(), month: Month, category_id: z.uuid(), assigned: Milliunits })
  .openapi("AssignedSet");

export const MoneyMove = z
  .object({
    budget_id: z.uuid(),
    month: Month,
    from_category_id: z.uuid().nullable(),
    to_category_id: z.uuid().nullable(),
    amount: Milliunits.positive(),
  })
  .refine((v) => v.from_category_id !== null || v.to_category_id !== null, {
    message: "Both sides cannot be Ready to Assign",
  })
  .refine((v) => v.from_category_id !== v.to_category_id, {
    message: "from_category_id and to_category_id must differ",
  })
  .openapi("MoneyMove");

export const MonthNoteSet = z
  .object({ budget_id: z.uuid(), month: Month, note: z.string().max(500).nullable() })
  .openapi("MonthNoteSet");

export type RtaBreakdown = z.infer<typeof RtaBreakdown>;
export type MonthCategoryDetail = z.infer<typeof MonthCategoryDetail>;
export type MonthGroupDetail = z.infer<typeof MonthGroupDetail>;
export type MonthDetail = z.infer<typeof MonthDetail>;
export type MonthSummary = z.infer<typeof MonthSummary>;
export type MonthCategory = z.infer<typeof MonthCategory>;
export type AssignedSet = z.infer<typeof AssignedSet>;
export type MoneyMove = z.infer<typeof MoneyMove>;
export type MonthNoteSet = z.infer<typeof MonthNoteSet>;
