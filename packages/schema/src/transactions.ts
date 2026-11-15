import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { Milliunits } from "./common/money";

// Repeats core's CLEARED_STATUSES; a Worker test asserts they are equal.
/** True only for a real calendar date: "2026-02-30" and "2026-13-05" round-trip to a different string. */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const ClearedStatus = z
  .enum(["uncleared", "cleared", "reconciled"])
  .openapi("ClearedStatus");

export const Transaction = z
  .object({
    id: z.uuid(),
    budget_id: z.uuid(),
    account_id: z.uuid(),
    date: IsoDate,
    payee_name: z.string().nullable(),
    category_id: z.uuid().nullable(),
    inflow_to_ready_to_assign: z.boolean(),
    memo: z.string().nullable(),
    amount: Milliunits,
    cleared: ClearedStatus,
    approved: z.boolean(),
    created_at: z.string(),
  })
  .openapi("Transaction");

export const TransactionCreate = z
  .object({
    budget_id: z.uuid(),
    account_id: z.uuid(),
    date: IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199"),
    amount: Milliunits,
    category_id: z.uuid().nullable().optional(),
    inflow_to_ready_to_assign: z.boolean().default(false),
    payee_name: z.string().max(200).nullable().optional(),
    memo: z.string().max(500).nullable().optional(),
    cleared: ClearedStatus.default("uncleared"),
    approved: z.boolean().default(true),
  })
  .refine((v) => isCalendarDate(v.date), { message: "date must be a real calendar date" })
  .refine((v) => !(v.category_id && v.inflow_to_ready_to_assign), {
    message: "A transaction cannot have both a category and the Ready to Assign inflow flag",
  })
  .openapi("TransactionCreate");

export type ClearedStatus = z.infer<typeof ClearedStatus>;
export type Transaction = z.infer<typeof Transaction>;
export type TransactionCreate = z.input<typeof TransactionCreate>;
export type TransactionCreateParsed = z.output<typeof TransactionCreate>;
