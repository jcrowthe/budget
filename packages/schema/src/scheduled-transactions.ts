import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { FREQUENCIES } from "./recurrence";
import { FlagColor, isCalendarDate, TransactionDetail } from "./transactions";

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
  })
  .strict();
/** The PATCH fields without the "at least one" rule, for the MCP tool's input shape. */
export const scheduledUpdateShape = updateFields.shape;
export const ScheduledTransactionUpdate = updateFields
  .refine((o) => Object.keys(o).length > 0, "Nothing to update")
  .openapi("ScheduledTransactionUpdate");
export type ScheduledTransactionUpdate = z.input<typeof ScheduledTransactionUpdate>;

export const SCHEDULED_BULK_OPS = ["enter_now", "delete"] as const;
export const ScheduledBulkRequest = z
  .object({
    op: z.enum(SCHEDULED_BULK_OPS),
    ids: z.array(z.string().min(1)).min(1).max(SCHEDULED_BULK_MAX),
  })
  .strict()
  .openapi("ScheduledBulkRequest");
export type ScheduledBulkRequest = z.input<typeof ScheduledBulkRequest>;

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
    skipped: z.array(z.object({ id: z.string(), reason: z.literal("changed") })),
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
