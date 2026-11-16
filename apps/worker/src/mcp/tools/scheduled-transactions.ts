import {
  ScheduledTransactionCreate as CreateSchema,
  SCHEDULER_ACTOR,
  type ScheduledTransactionCreate,
  type ScheduledTransactionUpdate,
  scheduledUpdateShape,
  Today,
} from "@budget/schema/scheduled-transactions";
import { z } from "zod";
import { getDb } from "../../db/client";
import { NotFound } from "../../middleware/errors";
import * as budgetsRepo from "../../repositories/budgets";
import {
  createScheduled,
  deleteScheduled,
  enterDue,
  enterScheduledNow,
  getScheduled,
  listScheduled,
  updateScheduled,
} from "../../services/scheduled-transactions";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const NOT_SUPPORTED =
  "Scheduled splits and scheduled transfers are not supported (a later ticket): a schedule is a plain transaction, so there is no transfer_account_id and no subtransactions.";
const FREQUENCIES_TEXT =
  "frequency is never, daily, weekly, everyOtherWeek, twiceAMonth, every4Weeks, monthly, everyOtherMonth, every3Months, every4Months, twiceAYear, yearly or everyOtherYear.";
const SHAPE =
  "id, account_id, account_name, date_first (the anchor every date is computed from), date_next (the next date not yet entered), frequency, amount, payee_id, payee_name, category_id, category_name, category_group_name, inflow_to_ready_to_assign, memo, flag_color (red, orange, yellow, green, blue, purple, or null), deleted, created_at and updated_at";
const TODAY = "today (YYYY-MM-DD) is the caller's date; it defaults to the server's UTC date.";
const STAMPS = timestamps(["created_at", "updated_at"]);

type Create = ScheduledTransactionCreate & { budget_id: string; today?: string };
type Update = ScheduledTransactionUpdate & { budget_id: string; id: string; today?: string };

export const tools: McpToolDef[] = [
  {
    name: "list_scheduled_transactions",
    description: `List a plan's scheduled transactions (future and repeating ones) by next date, optionally for one account. Schedules do not change balances or the plan until they are entered. Closed accounts' schedules are not listed. ${NOT_SUPPORTED} ${MONEY} ${dates("date_first", "date_next")} Returns { scheduled_transactions }, each with ${SHAPE}. ${STAMPS}`,
    inputSchema: z.object({ budget_id: Id, account_id: Id.optional() }),
    run: async (input: { budget_id: string; account_id?: string }, { env }) => ({
      scheduled_transactions: await listScheduled(env, input.budget_id, {
        accountId: input.account_id,
      }),
    }),
  },
  {
    name: "get_scheduled_transaction",
    description: `Read one scheduled transaction. An unknown, deleted or closed-account schedule is a tool error (not found). ${NOT_SUPPORTED} ${MONEY} ${dates("date_first", "date_next")} Returns { scheduled_transaction } with ${SHAPE}. ${STAMPS}`,
    inputSchema: z.object({ budget_id: Id, id: Id }),
    run: async (input: { budget_id: string; id: string }, { env }) => ({
      scheduled_transaction: await getScheduled(env, input.budget_id, input.id),
    }),
  },
  {
    name: "create_scheduled_transaction",
    description: `Create a scheduled transaction. A date_first after today, with any frequency, makes a schedule only: nothing real, no balance changes. A date_first on or before today with a frequency other than never also makes one real, unapproved, uncleared transaction on that date, and the schedule's date_next is the first date after today (missed dates in between are not entered). A date_first on or before today with frequency never is not a schedule: it is a tool error, create a transaction instead. ${FREQUENCIES_TEXT} Give a category_id or inflow_to_ready_to_assign: true, never both; the category is optional; a tracking account takes neither. Give payee_id or payee_name, never both (a new payee_name creates the payee). A closed account is a tool error (account_closed). ${NOT_SUPPORTED} ${MONEY} ${TODAY} ${dates("date_first", "date_next", "date", "today")} Returns { scheduled_transaction, transaction } with ${SHAPE}; transaction is the real transaction made, or null. ${STAMPS}`,
    inputSchema: z.object({
      budget_id: Id,
      ...CreateSchema.shape,
      today: Today.optional(),
    }),
    run: async (input: Create, { env, actor }) => {
      const { budget_id, today, ...rest } = input;
      return createScheduled(env, actor, budget_id, rest, today);
    },
  },
  {
    name: "update_scheduled_transaction",
    description: `Change a whole series (there is no "this occurrence only"). Sending date_first moves the series: it becomes the new anchor and date_next is computed again by the same rules as create (a date on or before today with a frequency enters one unapproved transaction; with never it is a tool error). Changing only frequency re-anchors the series at its current date_next. ${FREQUENCIES_TEXT} Every other field changes in place. ${NOT_SUPPORTED} ${MONEY} ${TODAY} ${dates("date_first", "date_next", "date", "today")} Returns { scheduled_transaction, transaction } with ${SHAPE}; transaction is the real transaction made, or null. ${STAMPS}`,
    inputSchema: z.object({
      budget_id: Id,
      id: Id,
      ...scheduledUpdateShape,
      today: Today.optional(),
    }),
    run: async (input: Update, { env, actor }) => {
      const { budget_id, id, today, ...patch } = input;
      return updateScheduled(env, actor, budget_id, id, patch, today);
    },
  },
  {
    name: "delete_scheduled_transaction",
    description: `Delete a whole series at once, with no confirmation. Real transactions already made from it stay. ${NOT_SUPPORTED} ${MONEY} ${dates("date_first", "date_next")} Returns { scheduled_transaction } as it was, with deleted: true: ${SHAPE}. ${STAMPS}`,
    inputSchema: z.object({ budget_id: Id, id: Id }),
    run: async (input: { budget_id: string; id: string }, { env, actor }) =>
      deleteScheduled(env, actor, input.budget_id, input.id),
  },
  {
    name: "enter_scheduled_transaction_now",
    description: `Enter a scheduled transaction now (the Enter Now button): a real transaction with the schedule's account, payee, category, memo, amount and flag, dated today (not the scheduled date), approved and uncleared. A repeating schedule moves one step from its scheduled date (date_next 11/25 monthly becomes 12/25); a one-off (never) is removed and comes back with deleted: true. ${TODAY} A closed account is a tool error (account_closed). ${NOT_SUPPORTED} ${MONEY} ${dates("date_first", "date_next", "date", "today")} Returns { transaction, scheduled_transaction }: the real transaction (id, account_id, date, payee_name, category_id, memo, amount, cleared, approved, flag_color, created_at, updated_at) and the schedule after the step (${SHAPE}). ${STAMPS}`,
    inputSchema: z.object({ budget_id: Id, id: Id, today: Today.optional() }),
    run: async (input: { budget_id: string; id: string; today?: string }, { env, actor }) =>
      enterScheduledNow(env, actor, input.budget_id, input.id, input.today),
  },
  {
    name: "enter_due_scheduled_transactions",
    description: `Enter what is due in a plan: every schedule whose date_next is on or before the day gets one real, unapproved, uncleared transaction dated its date_next, then moves to the first date after the day (missed dates in between are not entered); a one-off is removed. Running it again enters nothing more. The day is today, or else the server's UTC date. It enters at most 100 schedules per call, oldest first: call again while has_more is true. Entries are recorded as service:scheduler. ${NOT_SUPPORTED} ${dates("day", "date", "today")} Returns { day, entered: [{ scheduled_transaction_id, transaction_id, date }], has_more }.`,
    inputSchema: z.object({ budget_id: Id, today: Today.optional() }),
    run: async (input: { budget_id: string; today?: string }, { env }) => {
      if (!(await budgetsRepo.findActive(getDb(env), input.budget_id))) throw new NotFound("Plan");
      return enterDue(env, {
        budgetIds: [input.budget_id],
        day: input.today ?? new Date().toISOString().slice(0, 10),
        actor: SCHEDULER_ACTOR,
      });
    },
  },
];
