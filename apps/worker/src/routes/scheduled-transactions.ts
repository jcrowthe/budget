import { ErrorBody } from "@budget/schema/common/envelope";
import {
  EnterDueResponse,
  SCHEDULER_ACTOR,
  ScheduledBulkRequest,
  ScheduledBulkResponse,
  ScheduledCreateResponse,
  ScheduledEnterResponse,
  ScheduledTransactionCreate,
  ScheduledTransactionListResponse,
  ScheduledTransactionResponse,
  ScheduledTransactionUpdate,
  TodayQuery,
} from "@budget/schema/scheduled-transactions";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getDb } from "../db/client";
import type { AppEnv } from "../env";
import { apiError, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import {
  bulkScheduled,
  createScheduled,
  deleteScheduled,
  enterDue,
  enterScheduledNow,
  getScheduled,
  listScheduled,
  updateScheduled,
} from "../services/scheduled-transactions";
import { TransactionRefused } from "../services/transactions";

const tags = ["Scheduled transactions"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or scheduled transaction not found"),
  409: json(ErrorBody, "The scheduled transaction changed concurrently"),
  422: json(ErrorBody, "Invalid request"),
};
const base = "/budgets/{budget_id}/scheduled-transactions";
const budgetParam = z.object({ budget_id: param("budget_id") });
const idParams = z.object({
  budget_id: param("budget_id"),
  scheduled_transaction_id: param("scheduled_transaction_id"),
});
const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true as const,
});

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        422,
        "unprocessable_entity",
        result.error.issues.map((i) => i.message).join("; "),
      );
    }
  },
});

async function refusals<T>(c: Parameters<typeof apiError>[0], run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TransactionRefused) {
      return apiError(c, e.status, e.code, e.message) as never;
    }
    throw e;
  }
}

export default app
  .openapi(
    createRoute({
      method: "get",
      path: base,
      tags,
      request: {
        params: budgetParam,
        query: z.object({ account_id: z.string().min(1).optional() }),
      },
      responses: {
        200: json(
          ScheduledTransactionListResponse,
          "The plan's scheduled transactions on open accounts, by next date",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { account_id } = c.req.valid("query");
      const scheduled_transactions = await listScheduled(c.env, budget_id, {
        accountId: account_id,
      });
      return c.json({ data: { scheduled_transactions } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: base,
      tags,
      request: {
        params: budgetParam,
        query: TodayQuery,
        body: body(ScheduledTransactionCreate),
      },
      responses: {
        201: json(
          ScheduledCreateResponse,
          "The new scheduled transaction and, for a date on or before today with a repeat, the real transaction made for that date",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      const input = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () =>
        c.json({ data: await createScheduled(c.env, actor, budget_id, input, today) }, 201),
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: `${base}/bulk`,
      tags,
      request: { params: budgetParam, query: TodayQuery, body: body(ScheduledBulkRequest) },
      responses: {
        200: json(ScheduledBulkResponse, "Deleted: the schedules removed"),
        201: json(
          ScheduledBulkResponse,
          "Entered now: the real transactions and the schedules after",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      const input = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const data = await bulkScheduled(c.env, actor, budget_id, input, today);
        return c.json({ data }, input.op === "enter_now" ? 201 : 200) as never;
      });
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: `${base}/enter-due`,
      tags,
      request: { params: budgetParam, query: TodayQuery },
      responses: {
        200: json(
          EnterDueResponse,
          "What was entered: each schedule due on or before today gets one unapproved transaction",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      if (!(await budgetsRepo.findActive(getDb(c.env), budget_id))) throw new NotFound("Plan");
      const data = await enterDue(c.env, {
        budgetIds: [budget_id],
        day: today ?? new Date().toISOString().slice(0, 10),
        actor: SCHEDULER_ACTOR,
      });
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: `${base}/{scheduled_transaction_id}`,
      tags,
      request: { params: idParams },
      responses: {
        200: json(ScheduledTransactionResponse, "The scheduled transaction"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, scheduled_transaction_id } = c.req.valid("param");
      const scheduled_transaction = await getScheduled(c.env, budget_id, scheduled_transaction_id);
      return c.json({ data: { scheduled_transaction } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: `${base}/{scheduled_transaction_id}`,
      tags,
      request: { params: idParams, query: TodayQuery, body: body(ScheduledTransactionUpdate) },
      responses: {
        200: json(ScheduledCreateResponse, "The whole series after the change"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, scheduled_transaction_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      const input = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () =>
        c.json(
          {
            data: await updateScheduled(
              c.env,
              actor,
              budget_id,
              scheduled_transaction_id,
              input,
              today,
            ),
          },
          200,
        ),
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: `${base}/{scheduled_transaction_id}`,
      tags,
      request: { params: idParams },
      responses: {
        200: json(ScheduledTransactionResponse, "The deleted scheduled transaction"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, scheduled_transaction_id } = c.req.valid("param");
      const actor = c.get("identity").actor;
      return refusals(c, async () =>
        c.json(
          { data: await deleteScheduled(c.env, actor, budget_id, scheduled_transaction_id) },
          200,
        ),
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: `${base}/{scheduled_transaction_id}/enter`,
      tags,
      request: { params: idParams, query: TodayQuery },
      responses: {
        201: json(
          ScheduledEnterResponse,
          "The real transaction dated today (approved) and the schedule after one step; a one-off is removed",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, scheduled_transaction_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      const actor = c.get("identity").actor;
      return refusals(c, async () =>
        c.json(
          {
            data: await enterScheduledNow(c.env, actor, budget_id, scheduled_transaction_id, today),
          },
          201,
        ),
      );
    },
  );
