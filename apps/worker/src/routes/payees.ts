import { ErrorBody } from "@budget/schema/common/envelope";
import { PayeeListQuery, PayeeListResponse } from "@budget/schema/payees";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { listPayees } from "../services/payees";

const tags = ["Payees"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });

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

export default app.openapi(
  createRoute({
    method: "get",
    path: "/budgets/{budget_id}/payees",
    tags,
    request: { params: z.object({ budget_id: budgetParam }), query: PayeeListQuery },
    responses: {
      200: json(PayeeListResponse, "The plan's payees"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan not found"),
      422: json(ErrorBody, "Invalid request"),
    },
  }),
  async (c) => {
    const { budget_id } = c.req.valid("param");
    const { q, include_hidden } = c.req.valid("query");
    const payees = await listPayees(c.env, budget_id, {
      q,
      includeHidden: include_hidden === "true",
    });
    return c.json({ data: { payees } }, 200);
  },
);
