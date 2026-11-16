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

export const AgeOfMoneyQuery = z.object({ today: Today.optional() });
export const AgeOfMoneyMonth = z
  .object({ month: Month, days: z.number().int() })
  .openapi("AgeOfMoneyMonth");
export const AgeOfMoney = z
  .object({ current_days: z.number().int().nullable(), months: z.array(AgeOfMoneyMonth) })
  .openapi("AgeOfMoney");
export const AgeOfMoneyResponse = dataEnvelope(AgeOfMoney).openapi("AgeOfMoneyResponse");
export type AgeOfMoney = z.infer<typeof AgeOfMoney>;
export type AgeOfMoneyQuery = z.infer<typeof AgeOfMoneyQuery>;
export type ReportSettings = z.infer<typeof ReportSettings>;
export type ReportSettingsList = z.infer<typeof ReportSettingsList>;

export const SpendingGroupBy = z.enum(["category", "group"]).openapi("SpendingGroupBy");
export type SpendingGroupBy = z.infer<typeof SpendingGroupBy>;

export const SpendingBreakdownQuery = z
  .object({
    start_month: Month.optional(),
    end_month: Month.optional(),
    excluded_category_ids: IdList,
    excluded_account_ids: IdList,
    group_by: SpendingGroupBy.default("category"),
    group_id: z.string().min(1).max(64).optional(),
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
export type SpendingBreakdownQuery = z.infer<typeof SpendingBreakdownQuery>;

export const SpendingItem = z
  .object({
    id: z.string(),
    name: z.string(),
    group_name: z.string().nullable(),
    total: z.number().int(),
    share_pct: z.number().int(),
    transaction_count: z.number().int(),
  })
  .openapi("SpendingItem");
export type SpendingItem = z.infer<typeof SpendingItem>;
export const SpendingMostFrequent = z
  .object({ id: z.string(), name: z.string(), transaction_count: z.number().int() })
  .openapi("SpendingMostFrequent");
export const SpendingLargestOutflow = z
  .object({
    transaction_id: z.string(),
    payee_name: z.string().nullable(),
    amount: z.number().int(),
  })
  .openapi("SpendingLargestOutflow");
export const SpendingBreakdown = z
  .object({
    start_month: Month,
    end_month: Month,
    months: z.number().int(),
    days: z.number().int(),
    group_by: SpendingGroupBy,
    group: z.object({ id: z.string(), name: z.string() }).nullable(),
    total: z.number().int(),
    average_monthly: z.number().int(),
    average_daily: z.number().int(),
    most_frequent: SpendingMostFrequent.nullable(),
    largest_outflow: SpendingLargestOutflow.nullable(),
    items: z.array(SpendingItem),
  })
  .openapi("SpendingBreakdown");
export const SpendingBreakdownResponse = dataEnvelope(SpendingBreakdown).openapi(
  "SpendingBreakdownResponse",
);
export type SpendingBreakdown = z.infer<typeof SpendingBreakdown>;

export const ReportTransactionsQuery = z
  .object({
    start_month: Month,
    end_month: Month,
    category_id: z.string().min(1).max(64).optional(),
    group_id: z.string().min(1).max(64).optional(),
    uncategorized: z.enum(["true"]).optional(),
    income_payee_id: z.string().min(1).max(64).optional(),
    income: z.enum(["true"]).optional(),
    expenses: z.enum(["true"]).optional(),
    excluded_category_ids: IdList,
    excluded_account_ids: IdList,
  })
  .refine((v) => v.start_month <= v.end_month, {
    message: "start_month must not be after end_month",
  })
  .refine((v) => monthIndex(v.end_month) - monthIndex(v.start_month) < MAX_REPORT_MONTHS, {
    message: `At most ${MAX_REPORT_MONTHS} months`,
  })
  .refine(
    (v) =>
      [v.category_id, v.group_id, v.uncategorized, v.income_payee_id, v.income, v.expenses].filter(
        (x) => x !== undefined,
      ).length === 1,
    {
      message:
        "Give exactly one of category_id, group_id, uncategorized=true, income_payee_id, income=true or expenses=true",
    },
  );
export type ReportTransactionsQuery = z.infer<typeof ReportTransactionsQuery>;

export const ReportTransaction = z
  .object({
    transaction_id: z.string(),
    subtransaction_id: z.string().nullable(),
    account_id: z.string(),
    account_name: z.string(),
    date: IsoDate,
    payee_name: z.string().nullable(),
    memo: z.string().nullable(),
    amount: z.number().int(),
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    cleared: z.enum(["uncleared", "cleared", "reconciled"]),
  })
  .openapi("ReportTransaction");
export type ReportTransaction = z.infer<typeof ReportTransaction>;
export const ReportTransactionsResponse = dataEnvelope(
  z.object({ transactions: z.array(ReportTransaction) }).openapi("ReportTransactions"),
).openapi("ReportTransactionsResponse");

/** Both months or neither, start not after end, under the month cap (shared by the two new report queries). */
function spanRefined<
  S extends z.ZodObject<{
    start_month: z.ZodOptional<z.ZodString>;
    end_month: z.ZodOptional<z.ZodString>;
  }>,
>(schema: S): S {
  return schema
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
}

export const SpendingTrendsQuery = spanRefined(
  z.object({
    start_month: Month.optional(),
    end_month: Month.optional(),
    excluded_category_ids: IdList,
    excluded_account_ids: IdList,
    group_id: z.string().min(1).max(64).optional(),
    today: Today.optional(),
  }),
);
export type SpendingTrendsQuery = z.infer<typeof SpendingTrendsQuery>;

export const IncomeExpenseQuery = spanRefined(
  z.object({
    start_month: Month.optional(),
    end_month: Month.optional(),
    excluded_category_ids: IdList,
    excluded_account_ids: IdList,
    today: Today.optional(),
  }),
);
export type IncomeExpenseQuery = z.infer<typeof IncomeExpenseQuery>;

export const SpendingTrendsSeries = z
  .object({
    id: z.string(),
    name: z.string(),
    amount: z.number().int(),
    share_pct: z.number().nullable(),
  })
  .openapi("SpendingTrendsSeries");
export const SpendingTrendsMonth = z
  .object({
    month: Month,
    total: z.number().int(),
    compared_to_average: z.number().int(),
    compared_pct: z.number(),
    series: z.array(SpendingTrendsSeries),
  })
  .openapi("SpendingTrendsMonth");
export const SpendingTrends = z
  .object({
    start_month: Month,
    end_month: Month,
    group: z.object({ id: z.string(), name: z.string() }).nullable(),
    total: z.number().int(),
    average_monthly: z.number().int(),
    series: z.array(z.object({ id: z.string(), name: z.string(), total: z.number().int() })),
    months: z.array(SpendingTrendsMonth),
  })
  .openapi("SpendingTrends");
export const SpendingTrendsResponse =
  dataEnvelope(SpendingTrends).openapi("SpendingTrendsResponse");
export type SpendingTrends = z.infer<typeof SpendingTrends>;

const figures = {
  months: z.array(z.number().int()),
  average: z.number().int(),
  total: z.number().int(),
};
export const ReportFigures = z.object(figures).openapi("ReportFigures");
export type ReportFigures = z.infer<typeof ReportFigures>;
export const IncomeExpensePayee = z
  .object({ payee_id: z.string().nullable(), name: z.string(), ...figures })
  .openapi("IncomeExpensePayee");
export const IncomeExpenseCategory = z
  .object({ id: z.string(), name: z.string(), hidden: z.boolean(), ...figures })
  .openapi("IncomeExpenseCategory");
export const IncomeExpenseGroup = z
  .object({
    id: z.string(),
    name: z.string(),
    categories: z.array(IncomeExpenseCategory),
    total: ReportFigures,
  })
  .openapi("IncomeExpenseGroup");
export const IncomeExpense = z
  .object({
    start_month: Month,
    end_month: Month,
    months: z.array(Month),
    income: z.object({ payees: z.array(IncomeExpensePayee), total: ReportFigures }),
    expense: z.object({
      uncategorized: ReportFigures.nullable(),
      groups: z.array(IncomeExpenseGroup),
      total: ReportFigures,
    }),
    net_income: ReportFigures,
  })
  .openapi("IncomeExpense");
export const IncomeExpenseResponse = dataEnvelope(IncomeExpense).openapi("IncomeExpenseResponse");
export type IncomeExpense = z.infer<typeof IncomeExpense>;
