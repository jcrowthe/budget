import { Month } from "@budget/schema/common/dates";
import { ErrorBody } from "@budget/schema/common/envelope";
import {
  InputMonth,
  MonthDetailResponse,
  MonthListResponse,
  MonthNoteResponse,
  MonthNoteUpdate,
  MonthRangeResponse,
  MonthTotalsResponse,
} from "@budget/schema/months";
import { PlanView } from "@budget/schema/plan-views";
import { Today } from "@budget/schema/targets";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  getMonthRange,
  getMonthSummary,
  getPlanMonth,
  listPlanMonths,
  planMonthError,
  setMonthNote,
} from "../services/months";

const tags = ["Months"];
const MAX_MONTHS = 120;
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan not found"),
  422: json(ErrorBody, "Invalid month or range"),
};

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

const MAX_CATEGORY_IDS = 500;
const CATEGORY_IDS_MESSAGE = "category_ids must list category ids separated by commas";

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/months/{month}",
      tags,
      request: {
        params: z.object({
          budget_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "budget_id", in: "path" } }),
          month: Month.openapi({ param: { name: "month", in: "path" } }),
        }),
        query: z.object({
          view: PlanView.optional().openapi({
            description:
              "Narrow to the categories one of the Plan page's views shows (all, overspent, underfunded, overfunded, money_available, snoozed); default all",
          }),
          today: Today.optional().openapi({
            description:
              "The owner's local date (YYYY-MM-DD); it decides the current month for target figures. Default: the server's UTC date",
          }),
        }),
      },
      responses: { 200: json(MonthDetailResponse, "The month read model"), ...errors },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const { today, view } = c.req.valid("query");
      const bad = planMonthError(month, today);
      if (bad) return apiError(c, 422, "unprocessable_entity", bad) as never;
      return c.json({ data: await getPlanMonth(c.env, budget_id, month, today, view) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/months/{month}/summary",
      tags,
      request: {
        params: z.object({
          budget_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "budget_id", in: "path" } }),
          month: InputMonth.openapi({ param: { name: "month", in: "path" } }),
        }),
        query: z.object({
          category_ids: z.string().optional().openapi({
            description:
              "Category ids separated by commas (1 to 500); default: every visible category",
          }),
          view: PlanView.optional().openapi({
            description:
              "Narrow to the categories one of the Plan page's views shows (all, overspent, underfunded, overfunded, money_available, snoozed); default all",
          }),
          today: Today.optional().openapi({
            description:
              "The owner's local date (YYYY-MM-DD); it decides the current month for target figures. Default: the server's UTC date",
          }),
        }),
      },
      responses: {
        200: json(MonthTotalsResponse, "Totals of the month over the categories"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const { category_ids, today, view } = c.req.valid("query");
      if (category_ids !== undefined && view !== undefined) {
        return apiError(
          c,
          422,
          "unprocessable_entity",
          "Give category_ids or view, not both",
        ) as never;
      }
      let ids: string[] | undefined;
      if (category_ids !== undefined) {
        const parts = category_ids.split(",").map((x) => x.trim());
        ids = [...new Set(parts)];
        if (parts.some((x) => x === "") || ids.length > MAX_CATEGORY_IDS) {
          return apiError(c, 422, "unprocessable_entity", CATEGORY_IDS_MESSAGE) as never;
        }
      }
      return c.json(
        { data: await getMonthSummary(c.env, budget_id, month, ids, today, view) },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/months",
      tags,
      request: {
        params: z.object({
          budget_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "budget_id", in: "path" } }),
        }),
        query: z.object({ from: Month, to: Month }),
      },
      responses: {
        200: json(MonthListResponse, "Month summaries, from to to inclusive"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { from, to } = c.req.valid("query");
      const span = monthIndex(to) - monthIndex(from);
      if (span < 0 || span >= MAX_MONTHS) {
        // apiError's status is a union; the route declares 422 in `errors`, so narrow it for the typed handler.
        return apiError(
          c,
          422,
          "unprocessable_entity",
          `"to" must not be before "from", and the range at most ${MAX_MONTHS} months`,
        ) as never;
      }
      return c.json({ data: { months: await listPlanMonths(c.env, budget_id, from, to) } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/months/{month}",
      tags,
      request: {
        params: z.object({
          budget_id: z.uuid().openapi({ param: { name: "budget_id", in: "path" } }),
          month: InputMonth.openapi({ param: { name: "month", in: "path" } }),
        }),
        body: { required: true, content: { "application/json": { schema: MonthNoteUpdate } } },
      },
      responses: { 200: json(MonthNoteResponse, "The stored note"), ...errors },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const { note } = c.req.valid("json");
      const result = await setMonthNote(c.env, c.get("identity").actor, { budget_id, month, note });
      return c.json({ data: result }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/month-range",
      tags,
      request: {
        params: z.object({
          budget_id: z.uuid().openapi({ param: { name: "budget_id", in: "path" } }),
        }),
      },
      responses: {
        200: json(MonthRangeResponse, "Facts for the month navigation limits"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: await getMonthRange(c.env, budget_id) }, 200);
    },
  );
