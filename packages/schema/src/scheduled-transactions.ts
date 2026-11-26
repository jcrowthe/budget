import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { FREQUENCIES } from "./recurrence";
import { FlagColor, isCalendarDate, SubTransaction, TransactionDetail } from "./transactions";

export const SCHEDULED_BULK_MAX = 100;
/** The most schedules one call of "enter what is due" enters; the rest wait for the next call. */
export const SCHEDULER_MAX_PER_RUN = 100;
/** D1 calls the scheduler may use in the cron's invocation (a set read, a batch, one spare). */
export const SCHEDULER_CRON_CALLS = 3;
export const SCHEDULER_ACTOR = "service:scheduler";
export const CREATE_NOT_SCHEDULED =
  "A transaction dated today or earlier that does not repeat is not scheduled: create a transaction instead";
export const EDIT_NOT_SCHEDULED =
  "A scheduled transaction needs a date after today or a repeat: use Enter Now to record it today";

export const Frequency = z.enum(FREQUENCIES).openapi("ScheduledFrequency");

const YEAR_RANGE = /^(19|20|21)\d{2}-/;
const RealDate = IsoDate.regex(YEAR_RANGE, "Year must be between 1900 and 2199").refine(
  isCalendarDate,
  { message: "date must be a real calendar date" },
);
/** The day "today" means for a call: a real date, YYYY-MM-DD. */
export const Today = RealDate;

/** One line of a split schedule: the shape of a real split's line. */
export const ScheduledSubTransaction = SubTransaction.openapi("ScheduledSubTransaction");
export type ScheduledSubTransaction = z.infer<typeof ScheduledSubTransaction>;

export const SCHEDULED_SPLIT_MAX = 50;

/** A line in a request: the register's line (same keys, same limits). */
const LineInput = z
  .object({
    amount: Milliunits,
    payee_id: z.string().min(1).nullable().optional(),
    payee_name: z.string().max(200).nullable().optional(),
    category_id: z.string().min(1).nullable().optional(),
    inflow_to_ready_to_assign: z.boolean().optional(),
    memo: z.string().max(500).nullable().optional(),
  })
  .strict();
export type ScheduledLineInput = z.infer<typeof LineInput>;

export const ScheduledTransaction = z
  .object({
    id: z.string(),
    account_id: z.string(),
    account_name: z.string(),
    date_first: IsoDate,
    date_next: IsoDate,
    frequency: Frequency,
    amount: Milliunits,
    payee_id: z.string().nullable(),
    payee_name: z.string().nullable(),
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    category_group_name: z.string().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    memo: z.string().nullable(),
    flag_color: FlagColor.nullable(),
    transfer_account_id: z
      .string()
      .nullable()
      .describe("The other account when the schedule is a transfer; null for a plain schedule"),
    transfer_account_name: z.string().nullable(),
    subtransactions: z
      .array(ScheduledSubTransaction)
      .default([])
      .describe("Split lines; empty for a plain schedule or a transfer"),
    mirror: z
      .boolean()
      .describe(
        "True for the derived row an account lists for a transfer scheduled in another account: its id is the series id",
      ),
    deleted: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("ScheduledTransaction");
export type ScheduledTransaction = z.infer<typeof ScheduledTransaction>;

const linesField = z
  .array(LineInput)
  .max(SCHEDULED_SPLIT_MAX)
  .optional()
  .describe(
    "Split lines: at least two, whose signed amounts add up to amount. On update they replace all lines and an empty list makes the schedule plain. Not with transfer_account_id, category_id or inflow_to_ready_to_assign.",
  );

const fields = {
  account_id: z.string().min(1),
  date_first: RealDate.describe(
    "The first date of the series; every later date is computed from it. date_next is computed.",
  ),
  frequency: Frequency,
  amount: Milliunits,
  payee_id: z.string().min(1).nullable().optional(),
  payee_name: z.string().max(200).nullable().optional(),
  category_id: z.string().min(1).nullable().optional(),
  inflow_to_ready_to_assign: z.boolean().optional(),
  memo: z.string().max(500).nullable().optional(),
  flag_color: FlagColor.nullable().optional(),
  transfer_account_id: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Another account of the plan: the schedule is a transfer to it; its other side is derived, not stored.",
    ),
  subtransactions: linesField,
};

export const ScheduledTransactionCreate = z
  .object({ ...fields, frequency: Frequency.default("never") })
  .strict()
  .openapi("ScheduledTransactionCreate");
export type ScheduledTransactionCreate = z.input<typeof ScheduledTransactionCreate>;

const updateFields = z
  .object({
    account_id: fields.account_id.optional(),
    date_first: fields.date_first.optional(),
    frequency: fields.frequency.optional(),
    amount: fields.amount.optional(),
    payee_id: fields.payee_id,
    payee_name: fields.payee_name,
    category_id: fields.category_id,
    inflow_to_ready_to_assign: fields.inflow_to_ready_to_assign,
    memo: fields.memo,
    flag_color: fields.flag_color,
    transfer_account_id: fields.transfer_account_id,
    subtransactions: fields.subtransactions,
  })
  .strict();
/** The PATCH fields without the "at least one" rule, for the MCP tool's input shape. */
export const scheduledUpdateShape = updateFields.shape;
export const ScheduledTransactionUpdate = updateFields
  .refine((o) => Object.keys(o).length > 0, "Nothing to update")
  .openapi("ScheduledTransactionUpdate");
export type ScheduledTransactionUpdate = z.input<typeof ScheduledTransactionUpdate>;

export const SCHEDULED_BULK_OPS = [
  "enter_now",
  "delete",
  "categorize",
  "flag",
  "memo",
  "move",
] as const;

const ScheduledIds = z
  .array(z.string().min(1))
  .min(1)
  .max(SCHEDULED_BULK_MAX)
  .describe(
    "Series ids of the scheduled transactions (1 to 100); a mirror row's id is its series id",
  );

const bulkVariant = <O extends string, T extends z.ZodRawShape>(op: O, shape: T) =>
  z.object({ op: z.literal(op).describe("The operation"), ids: ScheduledIds, ...shape }).strict();

export const ScheduledBulkRequest = z
  .discriminatedUnion("op", [
    bulkVariant("enter_now", {}),
    bulkVariant("delete", {}),
    bulkVariant("categorize", {
      value: z.string().min(1).describe("A category id, or ready_to_assign"),
    }),
    bulkVariant("flag", {
      value: FlagColor.nullable().describe("A flag colour, or null to clear the flag"),
    }),
    bulkVariant("memo", {
      value: z.string().max(500).nullable().describe("The memo; null or blank clears it"),
    }),
    bulkVariant("move", {
      value: z.string().min(1).describe("The id of the account to move the schedules to"),
      mirror_ids: z
        .array(z.string().min(1))
        .max(SCHEDULED_BULK_MAX)
        .optional()
        .describe(
          "Series ids in ids that were selected only through their mirror row; move skips them",
        ),
    }).superRefine((o, ctx) => {
      for (const m of o.mirror_ids ?? []) {
        if (!o.ids.includes(m)) {
          ctx.addIssue({
            code: "custom",
            path: ["mirror_ids"],
            message: "mirror_ids must be in ids",
          });
          return;
        }
      }
    }),
  ])
  .openapi("ScheduledBulkRequest");
export type ScheduledBulkRequest = z.input<typeof ScheduledBulkRequest>;

export const ScheduledBulkSkipReason = z
  .enum(["changed", "unchanged", "split", "tracking_account", "category_not_needed", "mirror"])
  .openapi("ScheduledBulkSkipReason");
export type ScheduledBulkSkipReason = z.infer<typeof ScheduledBulkSkipReason>;

export const SCHEDULED_CATEGORIZE_NONE =
  "None of the selected scheduled transactions takes a category";
/** Why Duplicate and Export are off for scheduled rows (one definition for both bars). */
export const SCHEDULED_LATER = "Not available for scheduled transactions yet";
export const scheduledMirrorMoveText = (seriesAccount: string) =>
  `Scheduled in ${seriesAccount}: move it there`;

/**
 * Why categorize leaves a schedule alone, or null when it takes the category. The worker and the
 * action bar both use it. Symmetric: a mirror row (account and other account swapped) answers the same.
 */
export function scheduledCategorizeSkip(r: {
  split: boolean;
  onBudget: boolean;
  other: { onBudget: boolean } | null;
}): "split" | "tracking_account" | "category_not_needed" | null {
  if (r.split) return "split";
  if (r.other) {
    if (r.onBudget && r.other.onBudget) return "category_not_needed";
    if (!r.onBudget && !r.other.onBudget) return "tracking_account";
    return null;
  }
  return r.onBudget ? null : "tracking_account";
}

export function scheduledSkipText(
  reason: ScheduledBulkSkipReason,
  o: { seriesAccountName: string },
): string {
  switch (reason) {
    case "split":
      return "A split's category is in its lines";
    case "tracking_account":
      return "A tracking account's transactions take no category";
    case "category_not_needed":
      return "A transfer between on-plan accounts takes no category";
    case "unchanged":
      return "Already set";
    case "changed":
      return "The scheduled transaction changed; reload it";
    case "mirror":
      return scheduledMirrorMoveText(o.seriesAccountName);
  }
}

export const TodayQuery = z.object({
  today: Today.optional().describe(
    "The caller's date, YYYY-MM-DD; defaults to the server's UTC date",
  ),
});

export const ScheduledTransactionResponse = dataEnvelope(
  z.object({ scheduled_transaction: ScheduledTransaction }),
);
export const ScheduledTransactionListResponse = dataEnvelope(
  z.object({ scheduled_transactions: z.array(ScheduledTransaction) }),
);
export const ScheduledCreateResponse = dataEnvelope(
  z.object({
    scheduled_transaction: ScheduledTransaction,
    transaction: TransactionDetail.nullable(),
  }),
);
export const ScheduledEnterResponse = dataEnvelope(
  z.object({ transaction: TransactionDetail, scheduled_transaction: ScheduledTransaction }),
);
export const ScheduledBulkResponse = dataEnvelope(
  z.object({
    op: z.enum(SCHEDULED_BULK_OPS),
    results: z.array(
      z.object({
        id: z.string(),
        transaction: TransactionDetail.nullable(),
        scheduled_transaction: ScheduledTransaction,
      }),
    ),
    skipped: z.array(z.object({ id: z.string(), reason: ScheduledBulkSkipReason })),
  }),
);
export const EnterDueResponse = dataEnvelope(
  z.object({
    day: IsoDate,
    entered: z.array(
      z.object({
        scheduled_transaction_id: z.string(),
        transaction_id: z.string(),
        date: IsoDate,
      }),
    ),
    has_more: z.boolean(),
  }),
);
export type EnterDueResult = z.infer<typeof EnterDueResponse>["data"];
export type ScheduledBulkResult = z.infer<typeof ScheduledBulkResponse>["data"];
