import {
  AutoAssignBody,
  AutoAssignPreviewResponse,
  AutoAssignResultResponse,
} from "@budget/schema/auto-assign";
import { ErrorBody } from "@budget/schema/common/envelope";
import { InputMonth } from "@budget/schema/months";
import { PlanView } from "@budget/schema/plan-views";
import { Today } from "@budget/schema/targets";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { autoAssign, previewAutoAssign } from "../services/auto-assign";

const tags = ["Months"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or category not found"),
  409: json(ErrorBody, "The assigned amounts were changed concurrently"),
  422: json(ErrorBody, "Invalid month, scope, strategy or date"),
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
const params = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  month: InputMonth.openapi({ param: { name: "month", in: "path" } }),
});
const todayQuery = Today.optional().openapi({
  description:
    "The owner's local date (YYYY-MM-DD); it decides the current month for target figures. Default: the server's UTC date",
});

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/months/{month}/auto-assign",
      tags,
      request: {
        params,
        query: z.object({
          category_ids: z.string().optional().openapi({
            description:
              "Category ids separated by commas (1 to 500); default: the categories of view",
          }),
          view: PlanView.optional().openapi({
            description: "The Plan page view whose categories are previewed; default all",
          }),
          today: todayQuery,
        }),
      },
      responses: {
        200: json(AutoAssignPreviewResponse, "What each Auto-Assign option would do"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const { category_ids, view, today } = c.req.valid("query");
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
          return apiError(
            c,
            422,
            "unprocessable_entity",
            "category_ids must list category ids separated by commas",
          ) as never;
        }
      }
      const data = await previewAutoAssign(
        c.env,
        budget_id,
        month,
        { category_ids: ids, view },
        today,
      );
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/months/{month}/auto-assign",
      tags,
      request: {
        params,
        query: z.object({ today: todayQuery }),
        body: { required: true, content: { "application/json": { schema: AutoAssignBody } } },
      },
      responses: {
        200: json(AutoAssignResultResponse, "The category-months that changed"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const { today } = c.req.valid("query");
      const { strategy, category_ids, view } = c.req.valid("json");
      const data = await autoAssign(
        c.env,
        c.get("identity").actor,
        { budget_id, month, strategy, category_ids, view },
        today,
      );
      return c.json({ data }, 200);
    },
  );
