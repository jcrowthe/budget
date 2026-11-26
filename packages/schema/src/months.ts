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

/** A credit card's payment status for one month (EXF-537); see docs/card-payments-design.md. */
export const CardPayment = z
  .object({
    state: z.enum(["paid_off", "overpaid", "enough", "overspent_categories", "underfunded"]),
    underfunded: Milliunits,
    overspent_categories: Milliunits,
    current_balance: Milliunits,
    prior_balance: Milliunits,
    spending_and_outflows: Milliunits,
    interest_charges: Milliunits,
    payments_and_inflows: Milliunits,
    available: Milliunits,
    paid: Milliunits,
  })
  .openapi("CardPayment");

export const MonthCategoryDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    kind: z.enum(["credit_card_payment"]).nullable(),
    account_id: z.string().nullable(),
    cash_spending: Milliunits,
    credit_spending: Milliunits,
    overspent: z.object({ cash: Milliunits, credit: Milliunits }).nullable(),
    state: z.enum(["ok", "credit_overspent", "cash_overspent"]),
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
    carried: Milliunits,
    target: CategoryTargetMonth.nullable(),
    payment: CardPayment.nullable(),
    note: z.string().nullable(),
    target_snoozed: z.boolean(),
    /** EXF-505: scheduled transactions dated inside this month (summed, milliunits; 0 for a payment category). */
    upcoming: Milliunits,
    upcoming_count: z.number().int(),
    /** available + upcoming; not clamped. */
    available_after_upcoming: Milliunits,
    /** EXF-545: the open loan paired with this category (the first created, if several); null for others. */
    paired_account_id: z.string().nullable(),
    /** EXF-545: that loan's payments dated inside this month (milliunits; 0 when unpaired). */
    paid_this_month: Milliunits,
  })
  .openapi("MonthCategoryDetail");

export const MonthGroupDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    kind: z.enum(["credit_card_payments"]).nullable(),
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

/** Sums over a set of categories of one month; available = leftover + assigned + activity. */
export const MonthTotals = z
  .object({
    leftover: Milliunits,
    assigned: Milliunits,
    activity: Milliunits,
    available: Milliunits,
  })
  .openapi("MonthTotals");

export const MonthTotalsResponse = dataEnvelope(MonthTotals).openapi("MonthTotalsResponse");

/** One later month's assigned total (EXF-527). */
export const FutureAssignedMonth = z
  .object({ month: Month, assigned: Milliunits })
  .openapi("FutureAssignedMonth");

/** The month summary: the four totals, plus the future-assigned rows for the current month. */
export const MonthSummaryTotals = MonthTotals.extend({
  future_assigned: z.array(FutureAssignedMonth).optional().openapi({
    description:
      "Only for the current month (the month of `today`): the assigned total of every later month, in date order, from next month to the last month with money assigned (next month alone, at 0, when none). Covers the whole plan; category_ids and view do not change it. Absent for any other month.",
  }),
  future_assigned_total: Milliunits.optional().openapi({
    description:
      "Only for the current month: the sum of future_assigned; equals -rta_breakdown.assigned_in_future of the month read. Absent for any other month.",
  }),
  targets_total: Milliunits.openapi({
    description:
      "Cost to Be Me: the sum over the visible categories (not hidden, in a group not hidden) of every target's amount for the month (monthly: the amount; weekly: the amount times the weekday's occurrences in the month; yearly: a twelfth; custom balance: spread to its date, 0 with none; snoozed targets count). The whole plan: category_ids and view do not change it.",
  }),
  next_month_targets_total: Milliunits.openapi({
    description: "The same sum for the month after, whole plan, ignoring category_ids and view.",
  }),
}).openapi("MonthSummaryTotals");

export const MonthSummaryTotalsResponse = dataEnvelope(MonthSummaryTotals).openapi(
  "MonthSummaryTotalsResponse",
);

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

export type CardPayment = z.infer<typeof CardPayment>;
export type RtaBreakdown = z.infer<typeof RtaBreakdown>;
export type MonthCategoryDetail = z.infer<typeof MonthCategoryDetail>;
export type MonthGroupDetail = z.infer<typeof MonthGroupDetail>;
export type MonthDetail = z.infer<typeof MonthDetail>;
export type MonthTotals = z.infer<typeof MonthTotals>;
export type FutureAssignedMonth = z.infer<typeof FutureAssignedMonth>;
export type MonthSummaryTotals = z.infer<typeof MonthSummaryTotals>;
export type MonthSummary = z.infer<typeof MonthSummary>;
export type MonthCategory = z.infer<typeof MonthCategory>;
export type AssignedSet = z.infer<typeof AssignedSet>;
export type MoneyMove = z.infer<typeof MoneyMove>;
export type MonthNoteSet = z.infer<typeof MonthNoteSet>;
export type MonthNoteUpdate = z.infer<typeof MonthNoteUpdate>;
export type MonthNote = z.infer<typeof MonthNote>;
export type MonthRange = z.infer<typeof MonthRange>;
