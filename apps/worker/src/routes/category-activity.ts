import { CategoryActivityResponse } from "@budget/schema/category-activity";
import { ErrorBody } from "@budget/schema/common/envelope";
import { AssignedMonth } from "@budget/schema/month-categories";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { listCategoryActivity, PaymentCategoryRefused } from "../services/category-activity";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
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

export default app.openapi(
  createRoute({
    method: "get",
    path: "/budgets/{budget_id}/months/{month}/categories/{category_id}/transactions",
    tags: ["Months"],
    request: { params },
    responses: {
      200: json(CategoryActivityResponse, "The transactions behind a category's Activity"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or category not found"),
      422: json(ErrorBody, "Invalid month, or a credit card payment category"),
    },
  }),
  async (c) => {
    const { budget_id, month, category_id } = c.req.valid("param");
    try {
      return c.json(
        { data: await listCategoryActivity(c.env, budget_id, month, category_id) },
        200,
      );
    } catch (e) {
      if (e instanceof PaymentCategoryRefused)
        return apiError(c, 422, "payment_category", e.message) as never;
      throw e;
    }
  },
);
