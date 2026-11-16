import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { CategoryTargetMonth } from "./targets";

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
    target: CategoryTargetMonth.nullable(),
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

/** A month input, with the year bounded so a stray 0000-01-01 cannot make the read model span thousands of months. */
export const InputMonth = Month.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199");

export const AssignedSet = z
  .object({ budget_id: z.uuid(), month: InputMonth, category_id: z.uuid(), assigned: Milliunits })
  .openapi("AssignedSet");

export const MoneyMove = z
  .object({
    budget_id: z.uuid(),
    month: InputMonth,
    from_category_id: z.uuid().nullable(),
    to_category_id: z.uuid().nullable(),
    amount: Milliunits.positive(),
    kind: z.enum(["move", "cover"]).optional(),
  })
  .refine((v) => v.from_category_id !== null || v.to_category_id !== null, {
    message: "Both sides cannot be Ready to Assign",
  })
  .refine((v) => v.from_category_id !== v.to_category_id, {
    message: "from_category_id and to_category_id must differ",
  })
  .openapi("MoneyMove");

/** Generous cap: the source has no limit on a month note. */
export const MONTH_NOTE_MAX = 5000;

export const MonthNoteSet = z
  .object({
    budget_id: z.uuid(),
    month: InputMonth,
    note: z.string().max(MONTH_NOTE_MAX).nullable(),
  })
  .openapi("MonthNoteSet");

export const MonthNoteUpdate = z
  .object({ note: z.string().max(MONTH_NOTE_MAX).nullable() })
  .openapi("MonthNoteUpdate");

export const MonthNote = z
  .object({ month: Month, note: z.string().nullable() })
  .openapi("MonthNote");

export const MonthNoteResponse = dataEnvelope(MonthNote).openapi("MonthNoteResponse");

export const MonthRange = z
  .object({ first_month: Month, last_assigned_month: Month.nullable() })
  .openapi("MonthRange");

export const MonthRangeResponse = dataEnvelope(MonthRange).openapi("MonthRangeResponse");

export type RtaBreakdown = z.infer<typeof RtaBreakdown>;
export type MonthCategoryDetail = z.infer<typeof MonthCategoryDetail>;
export type MonthGroupDetail = z.infer<typeof MonthGroupDetail>;
export type MonthDetail = z.infer<typeof MonthDetail>;
export type MonthSummary = z.infer<typeof MonthSummary>;
export type MonthCategory = z.infer<typeof MonthCategory>;
export type AssignedSet = z.infer<typeof AssignedSet>;
export type MoneyMove = z.infer<typeof MoneyMove>;
export type MonthNoteSet = z.infer<typeof MonthNoteSet>;
export type MonthNoteUpdate = z.infer<typeof MonthNoteUpdate>;
export type MonthNote = z.infer<typeof MonthNote>;
export type MonthRange = z.infer<typeof MonthRange>;
