import { ErrorBody } from "@budget/schema/common/envelope";
import {
  AssignedMonth,
  AssignedResultResponse,
  AssignedUpdate,
  CategoryMonthResponse,
} from "@budget/schema/month-categories";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getMonthCategory, setAssignedAndRead } from "../services/month-categories";

const tags = ["Months"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or category not found"),
  409: json(ErrorBody, "The amount was changed concurrently"),
  422: json(ErrorBody, "Invalid month or amount"),
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

const params = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  month: AssignedMonth.openapi({ param: { name: "month", in: "path" } }),
  category_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "category_id", in: "path" } }),
});

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/months/{month}/categories/{category_id}",
      tags,
      request: { params },
      responses: {
        200: json(CategoryMonthResponse, "One category's figures for the month, with its note"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, month, category_id } = c.req.valid("param");
      return c.json({ data: await getMonthCategory(c.env, budget_id, month, category_id) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/months/{month}/categories/{category_id}",
      tags,
      request: {
        params: z.object({
          budget_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "budget_id", in: "path" } }),
          month: AssignedMonth.openapi({ param: { name: "month", in: "path" } }),
          category_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "category_id", in: "path" } }),
        }),
        body: { required: true, content: { "application/json": { schema: AssignedUpdate } } },
      },
      responses: {
        200: json(AssignedResultResponse, "The category's month amounts and Ready to Assign"),
        ...errors,
      },
    }),
    async (c) => {
      const data = await setAssignedAndRead(c.env, c.get("identity").actor, {
        ...c.req.valid("param"),
        ...c.req.valid("json"),
      });
      return c.json({ data }, 200);
    },
  );
