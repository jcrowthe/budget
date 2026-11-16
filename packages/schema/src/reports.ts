import { z } from "@hono/zod-openapi";
import { IsoDate, Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { monthIndex, RANGE_PRESETS } from "./report-range";
import { isCalendarDate } from "./transactions";

export const REPORT_SLUGS = [
  "spending-breakdown",
  "spending-trends",
  "net-worth",
  "income-expense",
  "age-of-money",
] as const;
export const ReportSlug = z.enum(REPORT_SLUGS).openapi("ReportSlug");
export type ReportSlug = z.infer<typeof ReportSlug>;

export const RangePreset = z.enum(RANGE_PRESETS).openapi("RangePreset");
export type RangePreset = z.infer<typeof RangePreset>;

export const DEFAULT_PRESETS: Record<ReportSlug, RangePreset> = {
  "spending-breakdown": "this_month",
  "spending-trends": "last_3_months",
  "net-worth": "all_dates",
  "income-expense": "last_3_months",
  "age-of-money": "all_dates",
};

/** Stands for "Uncategorized Transactions" in excluded_category_ids. */
export const UNCATEGORIZED_ID = "uncategorized";

export const ReportSettings = z
  .object({
    report: ReportSlug,
    preset: RangePreset,
    start_month: Month.nullable(),
    end_month: Month.nullable(),
    excluded_category_ids: z.array(z.string()),
    excluded_account_ids: z.array(z.string()),
    hide_export_dialog: z.boolean(),
  })
  .openapi("ReportSettings");

export const ReportSettingsList = z
  .object({ last_report: ReportSlug.nullable(), reports: z.array(ReportSettings) })
  .openapi("ReportSettingsList");
export const ReportSettingsResponse =
  dataEnvelope(ReportSettingsList).openapi("ReportSettingsResponse");

const ids = z.array(z.string().min(1).max(64)).max(2000);

export const ReportSettingsUpdate = z
  .strictObject({
    preset: RangePreset.optional(),
    start_month: Month.optional(),
    end_month: Month.optional(),
    excluded_category_ids: ids.optional(),
    excluded_account_ids: ids.optional(),
    hide_export_dialog: z.boolean().optional(),
    visited: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  })
  .refine(
    (v) =>
      v.preset === "custom"
        ? v.start_month !== undefined && v.end_month !== undefined && v.start_month <= v.end_month
        : true,
    { message: "custom needs start_month and end_month, with start_month not after end_month" },
  )
  .refine(
    (v) => (v.start_month === undefined && v.end_month === undefined) || v.preset === "custom",
    {
      message: "start_month and end_month are only for preset custom",
    },
  )
  .openapi("ReportSettingsUpdate");
export type ReportSettingsUpdate = z.infer<typeof ReportSettingsUpdate>;

export const Today = IsoDate.refine(isCalendarDate, "today must be a real calendar date").openapi({
  param: { name: "today", in: "query" },
  description:
    "The caller's local date (YYYY-MM-DD); its month is the current month. Absent: the Worker's UTC date.",
});

/** `a,b,c` -> ["a","b","c"]; empty or absent -> []. */
export const IdList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .refine((v) => v.length <= 2000, "At most 2000 ids")
  .openapi({ type: "string", example: "id1,id2" });

export const ReportRangeQuery = z
  .object({
    preset: RangePreset,
    start_month: Month.optional(),
    end_month: Month.optional(),
    today: Today.optional(),
  })
  .refine(
    (v) =>
      v.preset !== "custom" ||
      (v.start_month !== undefined && v.end_month !== undefined && v.start_month <= v.end_month),
    { message: "custom needs start_month and end_month, with start_month not after end_month" },
  )
  .openapi("ReportRangeQuery");
export type ReportRangeQuery = z.infer<typeof ReportRangeQuery>;

export const ReportRange = z
  .object({
    first_month: Month,
    current_month: Month,
    start_month: Month,
    end_month: Month,
  })
  .openapi("ReportRange");
export const ReportRangeResponse = dataEnvelope(ReportRange).openapi("ReportRangeResponse");
export type ReportRange = z.infer<typeof ReportRange>;

export const MAX_REPORT_MONTHS = 1200;

export const NetWorthQuery = z
  .object({
    start_month: Month.optional(),
    end_month: Month.optional(),
    excluded_account_ids: IdList,
    today: Today.optional(),
  })
  .refine((v) => (v.start_month === undefined) === (v.end_month === undefined), {
    message: "Give both start_month and end_month, or neither",
  })
  .refine((v) => !v.start_month || !v.end_month || v.start_month <= v.end_month, {
    message: "start_month must not be after end_month",
  })
  .refine(
    (v) =>
      !v.start_month ||
      !v.end_month ||
      monthIndex(v.end_month) - monthIndex(v.start_month) < MAX_REPORT_MONTHS,
    { message: `At most ${MAX_REPORT_MONTHS} months` },
  );
export type NetWorthQuery = z.infer<typeof NetWorthQuery>;

export const NetWorthMonth = z
  .object({
    month: Month,
    assets: z.number().int(),
    debts: z.number().int(),
    net_worth: z.number().int(),
    change: z.number().int(),
    change_pct: z.number().nullable(),
    accounts: z.array(z.object({ id: z.string(), name: z.string(), balance: z.number().int() })),
  })
  .openapi("NetWorthMonth");

export const NetWorth = z
  .object({
    first_month: Month,
    start_month: Month,
    end_month: Month,
    has_data: z.boolean(),
    assets: z.number().int(),
    debts: z.number().int(),
    net_worth: z.number().int(),
    change: z.number().int(),
    change_pct: z.number().nullable(),
    months: z.array(NetWorthMonth),
  })
  .openapi("NetWorth");
export const NetWorthResponse = dataEnvelope(NetWorth).openapi("NetWorthResponse");
export type NetWorth = z.infer<typeof NetWorth>;
export type ReportSettings = z.infer<typeof ReportSettings>;
export type ReportSettingsList = z.infer<typeof ReportSettingsList>;
